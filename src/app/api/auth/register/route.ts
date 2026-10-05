import { z } from "zod";
import { headers } from "next/headers";
import { route, body, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { env } from "@/lib/env";
import { hashPassword, passwordProblems } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { newId, newWrappedDek, UserCipher } from "@/lib/crypto";
import { audit, securityEvent } from "@/lib/audit";
import { defaultPrefs, defaultProfilePlain } from "@/lib/defaults";

const Schema = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(128) });

export const POST = route({ auth: "none", limit: 10 }, async ({ req, ip }) => {
  if (env().ALLOW_REGISTRATION !== "true") throw new ApiError(403, "Registration is disabled.");
  const { email, password } = await body(req, Schema);
  const users = await cols.users();
  // Single-user MVP: only the first account may register.
  if ((await users.countDocuments({})) > 0) throw new ApiError(403, "An account already exists. Sign in instead.");
  const problems = passwordProblems(password, email);
  if (problems.length) throw new ApiError(400, problems.join(" "));
  const _id = newId();
  const wrappedDek = newWrappedDek();
  await users.insertOne({
    _id, email, passwordHash: await hashPassword(password), role: "owner", wrappedDek,
    mfaEnabled: false, recoveryCodeHashes: [], failedLogins: 0, createdAt: new Date(),
  });
  const cipher = new UserCipher(_id, wrappedDek);
  await (await cols.prefs()).insertOne(defaultPrefs(_id));
  await (await cols.profiles()).insertOne({
    _id, userId: _id, plain: defaultProfilePlain(),
    sensitiveEnc: cipher.encJson({ fullName: "", email, phone: "" }), updatedAt: new Date(),
  });
  const h = await headers();
  await createSession(_id, ip, h.get("user-agent") ?? "", false);
  await audit({ userId: _id, actor: "user", action: "account_created" });
  await securityEvent({ userId: _id, type: "account_created", severity: "info", ip });
  return { ok: true, next: "/mfa" };
});
