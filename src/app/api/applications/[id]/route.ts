import { z } from "zod";
import { route, body, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { audit, notify } from "@/lib/audit";
import { canTransition } from "@/lib/applications";
import { APPLICATION_STATUSES } from "@/lib/types";

export const GET = route({ auth: "full" }, async ({ user, cipher, params }) => {
  const a = await (await cols.applications()).findOne({ _id: params.id, userId: user._id });
  if (!a) throw new ApiError(404, "Application not found.");
  const job = await (await cols.jobs()).findOne({ _id: a.jobId, userId: user._id }, { projection: { descriptionSanitized: 1, location: 1, url: 1, applyEmail: 1 } });
  const ev = await (await cols.evaluations()).find({ jobId: a.jobId, userId: user._id }).sort({ createdAt: -1 }).limit(1).next();
  const history = await (await cols.audit()).find({ userId: user._id, $or: [{ entityId: a.appId }, { entityId: a.jobId }] }).sort({ seq: 1 }).limit(100)
    .project({ _id: 0, ts: 1, actor: 1, action: 1, details: 1 }).toArray();
  const { notesEnc, coverLetterEnc, questions, ...rest } = a;
  return {
    application: {
      ...rest,
      notes: cipher.dec(notesEnc),
      coverLetter: cipher.dec(coverLetterEnc),
      questions: questions.map(({ answerEnc, ...q }) => ({ ...q, answer: cipher.dec(answerEnc) })),
    },
    job,
    evaluation: ev,
    history,
  };
});

const Patch = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  failureReason: z.string().trim().max(300).optional(),
  notes: z.string().max(5000).optional(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional(),
  hiringStatus: z.string().trim().max(120).optional(),
});

export const PATCH = route({ auth: "full", limit: 60 }, async ({ req, user, cipher, params }) => {
  const v = await body(req, Patch);
  const c = await cols.applications();
  const a = await c.findOne({ _id: params.id, userId: user._id });
  if (!a) throw new ApiError(404, "Application not found.");
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (v.status && v.status !== a.status) {
    if (!canTransition(a.status, v.status)) throw new ApiError(409, `Cannot move from ${a.status} to ${v.status}.`);
    if (v.status === "Applied") {
      const pending = a.questions.filter((q) => q.status !== "approved");
      if (pending.length) throw new ApiError(409, `Approve or remove ${pending.length} answer(s) before marking as applied.`);
      set.submittedAt = new Date();
    }
    if (v.status === "Application Failed") set.failureReason = v.failureReason || "Not specified";
    set.status = v.status;
  }
  if (v.notes !== undefined) set.notesEnc = cipher.enc(v.notes);
  if (v.followUpDate !== undefined) set.followUpDate = v.followUpDate || null;
  if (v.hiringStatus !== undefined) set.hiringStatus = v.hiringStatus;
  await c.updateOne({ _id: a._id }, { $set: set });
  if (set.status) {
    await audit({ userId: user._id, actor: "user", action: "application_status_changed", entity: "application", entityId: a.appId, details: { from: a.status, to: set.status, failureReason: v.status === "Application Failed" ? (v.failureReason ?? "") : undefined } });
    if (set.status === "Applied") await notify(user._id, "applied", `Applied: ${a.jobTitle}`, a.company, `/applications/${a._id}`);
    if (set.status === "Application Failed") await notify(user._id, "application_failed", `Application failed: ${a.jobTitle}`, v.failureReason ?? "", `/applications/${a._id}`);
  } else {
    await audit({ userId: user._id, actor: "user", action: "application_updated", entity: "application", entityId: a.appId });
  }
  return { ok: true };
});
