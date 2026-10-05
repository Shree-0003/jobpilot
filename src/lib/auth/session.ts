import "server-only";
import { cookies } from "next/headers";
import { cols } from "../db";
import { env } from "../env";
import { newId, randomToken, sha256, UserCipher } from "../crypto";
import type { SessionDoc, UserDoc } from "../types";

export const IDLE_MS = 30 * 60 * 1000;
export const ABSOLUTE_MS = 12 * 60 * 60 * 1000;

export const sessionCookieName = () => (env().COOKIE_SECURE === "true" ? "__Host-jp_session" : "jp_session");
export const CSRF_COOKIE = "jp_csrf";

export function cookieBase() {
  return { httpOnly: true, secure: env().COOKIE_SECURE === "true", sameSite: "strict" as const, path: "/" };
}

export async function createSession(userId: string, ip: string, userAgent: string, mfaVerified: boolean) {
  const token = randomToken(32);
  const now = new Date();
  const s: SessionDoc = {
    _id: newId(),
    tokenHash: sha256(token),
    userId,
    mfaVerified,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + ABSOLUTE_MS),
    ip,
    userAgent: userAgent.slice(0, 200),
  };
  await (await cols.sessions()).insertOne(s);
  const jar = await cookies();
  jar.set(sessionCookieName(), token, { ...cookieBase(), maxAge: ABSOLUTE_MS / 1000 });
  // Rotate the CSRF token together with the session.
  jar.set(CSRF_COOKIE, randomToken(24), { ...cookieBase(), httpOnly: false, maxAge: ABSOLUTE_MS / 1000 });
  return s;
}

export interface AuthContext {
  user: UserDoc;
  session: SessionDoc;
  cipher: UserCipher;
}

/** Resolves the current session; enforces idle and absolute timeouts. */
export async function currentSession(): Promise<AuthContext | null> {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (!token || token.length > 100) return null;
  const sessions = await cols.sessions();
  const s = await sessions.findOne({ tokenHash: sha256(token) });
  if (!s) return null;
  const now = Date.now();
  if (new Date(s.expiresAt).getTime() < now || new Date(s.lastSeenAt).getTime() + IDLE_MS < now) {
    await sessions.deleteOne({ _id: s._id });
    return null;
  }
  if (now - new Date(s.lastSeenAt).getTime() > 60_000) {
    await sessions.updateOne({ _id: s._id }, { $set: { lastSeenAt: new Date(now) } });
  }
  const user = await (await cols.users()).findOne({ _id: s.userId });
  if (!user) return null;
  return { user, session: s, cipher: new UserCipher(user._id, user.wrappedDek) };
}

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (token) await (await cols.sessions()).deleteOne({ tokenHash: sha256(token) });
  jar.delete(sessionCookieName());
}
