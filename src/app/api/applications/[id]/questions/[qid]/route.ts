import { z } from "zod";
import { route, body, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { audit } from "@/lib/audit";

const Schema = z.object({ answer: z.string().max(4000), approve: z.boolean() });

export const PATCH = route({ auth: "full", limit: 60 }, async ({ req, user, cipher, params }) => {
  const v = await body(req, Schema);
  const c = await cols.applications();
  const a = await c.findOne({ _id: params.id, userId: user._id });
  const q = a?.questions.find((x) => x.id === params.qid);
  if (!a || !q) throw new ApiError(404, "Question not found.");
  if (v.approve && !v.answer.trim()) throw new ApiError(400, "Write an answer before approving.");
  const edited = v.answer !== cipher.dec(q.answerEnc);
  const questions = a.questions.map((x) =>
    x.id === q.id
      ? { ...x, answerEnc: cipher.enc(v.answer), status: v.approve ? ("approved" as const) : x.status, approvedAt: v.approve ? new Date() : x.approvedAt, factIds: edited ? [] : x.factIds, reason: edited ? "Written or edited by you." : x.reason }
      : x,
  );
  await c.updateOne({ _id: a._id }, { $set: { questions, updatedAt: new Date() } });
  await audit({ userId: user._id, actor: "user", action: v.approve ? "answer_approved" : "answer_edited", entity: "application", entityId: a.appId, details: { questionId: q.id, editedByUser: edited } });
  return { ok: true };
});

export const DELETE = route({ auth: "full" }, async ({ user, params }) => {
  const c = await cols.applications();
  const r = await c.updateOne({ _id: params.id, userId: user._id }, { $pull: { questions: { id: params.qid } } });
  if (!r.matchedCount) throw new ApiError(404, "Not found.");
  return { ok: true };
});
