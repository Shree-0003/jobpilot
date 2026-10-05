import { z } from "zod";
import { route, body, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { audit, securityEvent } from "@/lib/audit";
import { detectInjection, sanitizeText } from "@/lib/jobs/sanitize";
import { evaluateJob } from "@/lib/jobs/service";
import { CONNECTORS } from "@/lib/jobs/connectors";

export const GET = route({ auth: "full" }, async ({ user, params }) => {
  const job = await (await cols.jobs()).findOne({ _id: params.id, userId: user._id });
  if (!job) throw new ApiError(404, "Job not found.");
  const evaluation = job.latestEvaluationId ? await (await cols.evaluations()).findOne({ _id: job.latestEvaluationId, userId: user._id }) : null;
  const application = await (await cols.applications()).findOne({ userId: user._id, jobId: job._id }, { projection: { _id: 1, appId: 1, status: 1 } });
  const resumes = await (await cols.resumes()).find({ userId: user._id, approved: true }).project({ _id: 1, label: 1 }).toArray();
  return { job, evaluation, application, resumes, connector: job.applyEmail ? CONNECTORS.email : CONNECTORS[job.portal] };
});

const Patch = z.object({ description: z.string().max(60_000) });

// Paste or replace the job description (e.g. for alert-email drafts), then re-score.
export const PATCH = route({ auth: "full", limit: 30 }, async ({ req, user, cipher, params }) => {
  const { description } = await body(req, Patch);
  const jobs = await cols.jobs();
  const job = await jobs.findOne({ _id: params.id, userId: user._id });
  if (!job) throw new ApiError(404, "Job not found.");
  if (job.status === "Approved") throw new ApiError(409, "Already approved.");
  const clean = sanitizeText(description);
  const signals = detectInjection(`${job.title}\n${clean}`);
  await jobs.updateOne({ _id: job._id }, { $set: { descriptionSanitized: clean, injectionFlag: signals.length > 0, injectionSignals: signals } });
  if (signals.length) await securityEvent({ userId: user._id, type: "prompt_injection_detected", severity: "medium", details: { jobId: job._id, signals } });
  await audit({ userId: user._id, actor: "user", action: "job_description_updated", entity: "job", entityId: job._id });
  const ev = await evaluateJob(user, cipher, job._id);
  return { ok: true, decision: ev?.policyDecision };
});
