import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PAGES = ["/login", "/register", "/mfa"];

function b64(bytes: Uint8Array) {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function middleware(req: NextRequest) {
  const nonce = b64(crypto.getRandomValues(new Uint8Array(16)));
  const dev = process.env.NODE_ENV !== "production";
  const https = process.env.COOKIE_SECURE === "true";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api/");
  const hasSession = req.cookies.has("jp_session") || req.cookies.has("__Host-jp_session");
  if (!isApi && !hasSession && !PUBLIC_PAGES.includes(path)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  if (https) res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  if (!req.cookies.has("jp_csrf")) {
    res.cookies.set("jp_csrf", b64(crypto.getRandomValues(new Uint8Array(24))), {
      httpOnly: false,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      path: "/",
    });
  }
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
