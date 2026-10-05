import { z } from "zod";
import { route, body, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { audit } from "@/lib/audit";
import { listFacts } from "@/lib/facts";
import { generateCoverLetter } from "@/lib/ai/gateway";
import { validateCoverLetter } from "@/lib/ai/guardrails";

const Gen = z.object({ tone: z.enum(["formal", "professional", "short", "technical"]) });

export const POST = route({ auth: "full", limit: 10 }, async ({ req, user, cipher, params }) => {
  const { tone } = await body(req, Gen);
  const c = await cols.applications();
  const a = await c.findOne({ _id: params.id, userId: user._id });
  if (!a) throw new ApiError(404, "Application not found.");
  const job = await (await cols.jobs()).findOne({ _id: a.jobId, userId: user._id });
  const facts = await listFacts(user._id, cipher, true);
  const r = await generateCoverLetter(user._id, facts, { title: a.jobTitle, company: a.company, description: job?.injectionFlag ? "" : job?.descriptionSanitized ?? "" }, tone);
  await c.updateOne({ _id: a._id }, { $set: { coverLetterEnc: cipher.enc(r.text), coverLetterFlags: r.flags, updatedAt: new Date() } });
  await audit({ userId: user._id, actor: "ai", action: "cover_letter_generated", entity: "application", entityId: a.appId, details: { tone, source: r.source, flags: r.flags.length } });
  return { text: r.text, flags: r.flags, source: r.source };
});

const Save = z.object({ text: z.string().max(8000) });
export const PUT = route({ auth: "full", limit: 30 }, async ({ req, user, cipher, params }) => {
  const { text } = await body(req, Save);
  const c = await cols.applications();
  const a = await c.findOne({ _id: params.id, userId: user._id });
  if (!a) throw new ApiError(404, "Application not found.");
  const flags = validateCoverLetter(text, await listFacts(user._id, cipher, true));
  await c.updateOne({ _id: a._id }, { $set: { coverLetterEnc: cipher.enc(text), coverLetterFlags: flags, updatedAt: new Date() } });
  await audit({ userId: user._id, actor: "user", action: "cover_letter_saved", entity: "application", entityId: a.appId });
  return { ok: true, flags };
});
