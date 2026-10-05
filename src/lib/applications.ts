import "server-only";
import { cols, nextSeq } from "./db";
import { newId, type UserCipher } from "./crypto";
import { audit, notify } from "./audit";
import { ApiError } from "./http";
import { capCounts } from "./jobs/service";
import { CONNECTORS } from "./jobs/connectors";
import type { ApplicationDoc, ApplicationStatus, PrefsDoc, UserDoc } from "./types";

export const TRANSITIONS: Partial<Record<ApplicationStatus, ApplicationStatus[]>> = {
  "Manual Action Required": ["Applied", "Application Failed", "Withdrawn", "Closed"],
  "Application Failed": ["Manual Action Required", "Withdrawn", "Closed"],
  Applied: ["Interview", "Rejected", "Offer", "Withdrawn", "Closed"],
  Interview: ["Interview", "Offer", "Rejected", "Withdrawn", "Closed"],
  Offer: ["Closed", "Withdrawn"],
  Rejected: ["Closed"],
  Withdrawn: ["Closed"],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

const APPROVABLE = new Set(["Awaiting Approval", "Shortlisted", "Manual Action Required", "Low Relevance"]);
const RISKY = /PROMPT_INJECTION|SUSPICIOUS_POSTING/;

export async function approveJob(user: UserDoc, cipher: UserCipher, jobId: string, opts: { resumeId?: string; acknowledgeRisk?: boolean; ip: string }) {
  const prefs = (await (await cols.prefs()).findOne({ _id: user._id })) as PrefsDoc;
  if (prefs.automationState === "stopped") throw new ApiError(409, "Emergency Stop is active. Resume automation in the header first.");
  if (prefs.automationState === "paused") throw new ApiError(409, "Automation is paused. Resume it to approve applications.");

  const job = await (await cols.jobs()).findOne({ _id: jobId, userId: user._id });
  if (!job) throw new ApiError(404, "Job not found.");
  if (!APPROVABLE.has(job.status)) throw new ApiError(409, `A job in status "${job.status}" cannot be approved.`);
  const ev = job.latestEvaluationId ? await (await cols.evaluations()).findOne({ _id: job.latestEvaluationId, userId: user._id }) : null;
  if (!ev) throw new ApiError(409, "Evaluate the job before approving it.");
  if (ev.riskFlags.some((f) => RISKY.test(f)) && !opts.acknowledgeRisk) {
    throw new ApiError(409, "This posting has security or scam flags. Tick the acknowledgement to continue.", { needsAcknowledgement: true });
  }

  // Duplicate prevention: no second application for this job or the same company + title.
  const sameJobs = await (await cols.jobs()).find({ userId: user._id, dedupeHash: job.dedupeHash }).project<{ _id: string }>({ _id: 1 }).toArray();
  const apps = await cols.applications();
  const existing = await apps.findOne({ userId: user._id, jobId: { $in: sameJobs.map((j) => j._id) } });
  if (existing) throw new ApiError(409, `Already in your register as ${existing.appId}.`);

  const c = await capCounts(user._id, job.company);
  const L = prefs.limits;
  if (c.today >= L.maxPerDay) throw new ApiError(429, `Daily limit reached (${L.maxPerDay}).`);
  if (c.lastHour >= L.maxPerHour) throw new ApiError(429, `Hourly limit reached (${L.maxPerHour}).`);
  if (c.companyToday >= L.maxPerCompanyPerDay) throw new ApiError(429, `Per-company daily limit reached for ${job.company} (${L.maxPerCompanyPerDay}).`);

  const resumes = await cols.resumes();
  const resumeId = opts.resumeId ?? ev.recommendedResumeId;
  const resume = resumeId ? await resumes.findOne({ _id: resumeId, userId: user._id, approved: true, scanStatus: "clean" }) : null;
  if (resumeId && !resume) throw new ApiError(400, "Choose an approved resume.");

  const connector = job.applyEmail ? CONNECTORS.email : CONNECTORS[job.portal] ?? CONNECTORS.other;
  const now = new Date();
  const app: ApplicationDoc = {
    _id: newId(),
    userId: user._id,
    appId: `APP-${String(await nextSeq(`app:${user._id}`)).padStart(6, "0")}`,
    jobId: job._id,
    jobTitle: job.title,
    company: job.company,
    portal: job.portal,
    jobUrl: job.url,
    matchScore: ev.matchScore,
    resumeId: resume?._id,
    resumeLabel: resume?.label,
    status: "Manual Action Required",
    automationStatus: "Manual",
    channel: "human_submit",
    actionReason: `Submit on ${connector.name} yourself — ${connector.note.split(/\.\s/)[0].replace(/\.$/, "")}.`,
    questions: [],
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await apps.insertOne(app);
  await (await cols.jobs()).updateOne({ _id: job._id }, { $set: { status: "Approved" } });
  await audit({ userId: user._id, actor: "user", action: "application_approved", entity: "application", entityId: app.appId, details: { jobId: job._id, matchScore: ev.matchScore, decision: ev.policyDecision, resume: resume?.label ?? null, acknowledgedRisk: !!opts.acknowledgeRisk } });
  await notify(user._id, "action_required", `Ready to submit: ${job.title}`, `${job.company} — open the Apply Pack and submit on ${connector.name}.`, `/applications/${app._id}`);
  void cipher;
  return app;
}
