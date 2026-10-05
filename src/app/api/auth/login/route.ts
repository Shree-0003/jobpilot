import { z } from "zod";
import { headers } from "next/headers";
import { route, body, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { audit, securityEvent } from "@/lib/audit";

const Schema = z.object({ email: z.string().trim().toLowerCase().max(254), password: z.string().min(1).max(128) });
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
// Real Argon2id hash of a random value so unknown emails take the same time as wrong passwords.
let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashPassword(crypto.randomUUID()));

export const POST = route({ auth: "none", limit: 10 }, async ({ req, ip }) => {
  const { email, password } = await body(req, Schema);
  const users = await cols.users();
  const user = await users.findOne({ email });
  const generic = new ApiError(401, "Email or password is incorrect.");
  if (!user) {
    await verifyPassword(await dummyHash(), password);
    await securityEvent({ type: "login_failed_unknown_user", severity: "low", ip });
    throw generic;
  }
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    await securityEvent({ userId: user._id, type: "login_while_locked", severity: "medium", ip });
    throw new ApiError(423, "Account temporarily locked after repeated failures. Try again later.");
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    const fails = (user.failedLogins ?? 0) + 1;
    const lock = fails >= MAX_FAILS;
    await users.updateOne({ _id: user._id }, { $set: { failedLogins: lock ? 0 : fails, ...(lock ? { lockedUntil: new Date(Date.now() + LOCK_MS) } : {}) } });
    await securityEvent({ userId: user._id, type: lock ? "account_locked" : "login_failed", severity: lock ? "high" : "low", ip, details: { fails } });
    throw generic;
  }
  await users.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lastLoginAt: new Date() }, $unset: { lockedUntil: "" } });
  const h = await headers();
  // New session token on every login (prevents session fixation). MFA still pending.
  await createSession(user._id, ip, h.get("user-agent") ?? "", false);
  await audit({ userId: user._id, actor: "user", action: "login_password_ok" });
  return { ok: true, next: "/mfa" };
});
