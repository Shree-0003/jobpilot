import { z } from "zod";
import crypto from "node:crypto";
import { route, body, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { matchTotpStep } from "@/lib/auth/totp";
import { sha256 } from "@/lib/crypto";
import { audit, securityEvent } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";

const Schema = z.object({ code: z.string().trim().min(6).max(20) });

export const POST = route({ auth: "pre-mfa", limit: 10 }, async ({ req, ip, user, session, cipher }) => {
  const { code } = await body(req, Schema);
  const rl = rateLimit(`mfa:${session._id}`, 5, 15 * 60_000);
  const sessions = await cols.sessions();
  if (!rl.ok) {
    await sessions.deleteOne({ _id: session._id });
    await securityEvent({ userId: user._id, type: "mfa_bruteforce_blocked", severity: "high", ip });
    throw new ApiError(429, "Too many MFA attempts. Sign in again.");
  }
  const users = await cols.users();
  let recoveryCodes: string[] | undefined;
  if (!user.mfaEnabled) {
    const secret = cipher.dec(user.mfaPendingSecretEnc);
    const step = secret ? matchTotpStep(secret, code) : null;
    if (step === null) {
      await securityEvent({ userId: user._id, type: "mfa_enrol_failed", severity: "low", ip });
      throw new ApiError(400, "That code did not match. Check your authenticator app's time and try again.");
    }
    recoveryCodes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString("hex"));
    await users.updateOne(
      { _id: user._id },
      { $set: { mfaEnabled: true, mfaLastStep: step, mfaSecretEnc: cipher.enc(secret), recoveryCodeHashes: recoveryCodes.map((c) => sha256(c)) }, $unset: { mfaPendingSecretEnc: "" } },
    );
    await audit({ userId: user._id, actor: "user", action: "mfa_enabled" });
  } else {
    const secret = cipher.dec(user.mfaSecretEnc);
    const step = matchTotpStep(secret, code);
    // A code may be used once: reject steps at or before the last accepted one (replay).
    const replay = step !== null && user.mfaLastStep !== undefined && step <= user.mfaLastStep;
    const ok = step !== null && !replay;
    if (replay) await securityEvent({ userId: user._id, type: "mfa_code_replay", severity: "medium", ip });
    if (ok) await users.updateOne({ _id: user._id }, { $set: { mfaLastStep: step } });
    const rcHash = sha256(code.toLowerCase());
    const usedRecovery = !ok && user.recoveryCodeHashes.includes(rcHash);
    if (!ok && !usedRecovery) {
      await securityEvent({ userId: user._id, type: "mfa_failed", severity: "medium", ip });
      throw new ApiError(400, "Invalid code.");
    }
    if (usedRecovery) {
      await users.updateOne({ _id: user._id }, { $pull: { recoveryCodeHashes: rcHash } });
      await securityEvent({ userId: user._id, type: "recovery_code_used", severity: "medium", ip });
    }
  }
  await sessions.updateOne({ _id: session._id }, { $set: { mfaVerified: true } });
  const known = await sessions.countDocuments({ userId: user._id, ip, mfaVerified: true, _id: { $ne: session._id } });
  await securityEvent({ userId: user._id, type: known ? "login_success" : "login_new_location", severity: known ? "info" : "low", ip });
  await audit({ userId: user._id, actor: "user", action: "login_mfa_ok" });
  return { ok: true, recoveryCodes };
});
