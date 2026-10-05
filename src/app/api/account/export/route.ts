import { z } from "zod";
import { route, body, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { audit, securityEvent } from "@/lib/audit";
import { listFacts } from "@/lib/facts";
import type { ProfileSensitive } from "@/lib/types";

const Schema = z.object({ password: z.string().min(1).max(128) });

// Full personal-data export (decrypted). Requires the password again.
export const POST = route({ auth: "full", limit: 5 }, async ({ req, user, cipher, ip }) => {
  const { password } = await body(req, Schema);
  if (!(await verifyPassword(user.passwordHash, password))) {
    await securityEvent({ userId: user._id, type: "reauth_failed", severity: "medium", ip, details: { action: "export" } });
    throw new ApiError(403, "Password is incorrect.");
  }
  const profile = await (await cols.profiles()).findOne({ _id: user._id });
  const prefs = await (await cols.prefs()).findOne({ _id: user._id });
  const resumes = await (await cols.resumes()).find({ userId: user._id }).project({ objectKey: 0 }).toArray();
  const jobs = await (await cols.jobs()).find({ userId: user._id }).toArray();
  const apps = await (await cols.applications()).find({ userId: user._id }).toArray();
  const data = {
    exportedAt: new Date().toISOString(),
    account: { email: user.email, createdAt: user.createdAt, mfaEnabled: user.mfaEnabled },
    profile: { ...profile?.plain, ...(cipher.decJson<ProfileSensitive>(profile?.sensitiveEnc) ?? {}) },
    verifiedFacts: await listFacts(user._id, cipher),
    preferences: prefs,
    resumes,
    jobs,
    applications: apps.map(({ notesEnc, coverLetterEnc, questions, ...a }) => ({ ...a, notes: cipher.dec(notesEnc), coverLetter: cipher.dec(coverLetterEnc), questions: questions.map(({ answerEnc, ...q }) => ({ ...q, answer: cipher.dec(answerEnc) })) })),
  };
  await audit({ userId: user._id, actor: "user", action: "personal_data_exported" });
  await securityEvent({ userId: user._id, type: "personal_data_exported", severity: "medium", ip });
  return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="jobpilot-my-data.json"`, "Cache-Control": "no-store" } });
});
