import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import { ZodError, type ZodTypeAny, type infer as ZInfer } from "zod";
import { currentSession, CSRF_COOKIE, type AuthContext } from "./auth/session";
import { safeEqual } from "./crypto";
import { env } from "./env";
import { rateLimit } from "./ratelimit";
import { securityEvent } from "./audit";

export class ApiError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local").slice(0, 64);
}

type AuthLevel = "none" | "pre-mfa" | "full";
interface Opts {
  auth: AuthLevel;
  /** requests per minute per IP+route */
  limit?: number;
}

type Ctx<A extends AuthLevel> = {
  req: NextRequest;
  ip: string;
  params: Record<string, string>;
} & (A extends "none" ? Partial<AuthContext> : AuthContext);

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function checkCsrf(req: NextRequest, ip: string, userId?: string) {
  // 1) Origin must be our own origin (blocks cross-site form posts and fetches).
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  const allowed = new Set([new URL(env().APP_ORIGIN).origin]);
  if (host) allowed.add(`${req.nextUrl.protocol}//${host}`);
  // 2) Double-submit token: header must equal the SameSite=Strict cookie.
  const jar = await cookies();
  const cookieTok = jar.get(CSRF_COOKIE)?.value ?? "";
  const headerTok = req.headers.get("x-csrf-token") ?? "";
  const ok = !!origin && allowed.has(origin) && cookieTok.length >= 16 && safeEqual(cookieTok, headerTok);
  if (!ok) {
    await securityEvent({ userId, type: "csrf_rejected", severity: "medium", ip, details: { path: req.nextUrl.pathname } });
    throw new ApiError(403, "Request blocked by CSRF protection.");
  }
}

export function route<A extends AuthLevel>(opts: Opts & { auth: A }, handler: (ctx: Ctx<A>) => Promise<Response | unknown>) {
  return async (req: NextRequest, routeCtx: { params: Promise<Record<string, string>> }) => {
    const ip = await clientIp();
    try {
      const rl = rateLimit(`${ip}:${req.method}:${req.nextUrl.pathname}`, opts.limit ?? 120, 60_000);
      if (!rl.ok) {
        await securityEvent({ type: "rate_limited", severity: "low", ip, details: { path: req.nextUrl.pathname } });
        throw new ApiError(429, "Too many requests. Try again shortly.", { retryAfter: rl.retryAfterSec });
      }
      let auth: AuthContext | null = null;
      if (opts.auth !== "none") {
        auth = await currentSession();
        if (!auth) throw new ApiError(401, "Sign in required.");
        if (opts.auth === "full" && !auth.session.mfaVerified) throw new ApiError(401, "MFA verification required.");
      } else {
        auth = await currentSession();
      }
      if (MUTATING.has(req.method)) await checkCsrf(req, ip, auth?.user._id);
      const params = (await routeCtx?.params) ?? {};
      const result = await handler({ req, ip, params, ...(auth ?? {}) } as Ctx<A>);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json({ error: e.message, ...(e.extra ?? {}) }, { status: e.status, headers: { "Cache-Control": "no-store" } });
      }
      if (e instanceof ZodError) {
        return NextResponse.json(
          { error: "Invalid input.", fields: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
          { status: 400 },
        );
      }
      // Never echo internals or request data.
      console.error(`[api] ${req.method} ${req.nextUrl.pathname} failed:`, (e as Error)?.message);
      return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
    }
  };
}

export async function body<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<ZInfer<S>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 1_000_000) throw new ApiError(413, "Request too large.");
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "Body must be JSON.");
  }
  return schema.parse(raw);
}
