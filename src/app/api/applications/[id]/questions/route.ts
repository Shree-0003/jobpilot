import { z } from "zod";
import { route, body, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { newId } from "@/lib/crypto";
import { audit, securityEvent } from "@/lib/audit";
import { listFacts } from "@/lib/facts";
import { draftAnswer } from "@/lib/ai/gateway";
import { detectInjection, sanitizeText } from "@/lib/jobs/sanitize";

const Schema = z.object({ questions: z.array(z.string().max(1000)).min(1).max(25) });

export const POST = route({ auth: "full", limit: 20 }, async ({ req, user, cipher, params }) => {
  const { questions } = await body(req, Schema);
  const c = await cols.applications();
  const a = await c.findOne({ _id: params.id, userId: user._id });
  if (!a) throw new ApiError(404, "Application not found.");
  if (a.questions.length + questions.length > 40) throw new ApiError(400, "Too many questions on one application.");
  const facts = await listFacts(user._id, cipher, true);
  const added = [];
  for (const raw of questions) {
    const q = sanitizeText(raw, 1000);
    if (!q) continue;
    const signals = detectInjection(q);
    let d;
    if (signals.length) {
      await securityEvent({ userId: user._id, type: "prompt_injection_detected", severity: "medium", details: { applicationId: a.appId, signals } });
      d = { answer: "", factIds: [] as string[], status: "human_review_required" as const, reason: "Question contains instructions aimed at the AI; not sent to the model.", sensitive: false, source: "none" as const };
    } else {
      d = await draftAnswer(user._id, facts, q, { title: a.jobTitle, company: a.company });
    }
    const item = { id: newId(), question: q, answerEnc: cipher.enc(d.answer), factIds: d.factIds, status: d.status, reason: d.reason, sensitive: d.sensitive };
    added.push(item);
    await audit({ userId: user._id, actor: "ai", action: "answer_drafted", entity: "application", entityId: a.appId, details: { status: d.status, source: d.source, factIds: d.factIds, sensitive: d.sensitive } });
  }
  await c.updateOne({ _id: a._id }, { $push: { questions: { $each: added } }, $set: { updatedAt: new Date() } });
  return { added: added.length };
});
