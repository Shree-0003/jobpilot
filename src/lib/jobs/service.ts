import "server-only";
import { cols } from "../db";
import { newId, type UserCipher } from "../crypto";
import { audit, notify, securityEvent } from "../audit";
import { listFacts } from "../facts";
import { baselineScore, pickResume } from "../ai/baseline";
import { llm, llmEvaluate } from "../ai/gateway";
import { PROMPT_VERSION } from "../ai/schemas";
import { decide, STATUS_FOR } from "../policy/engine";
import { connectorPolicy } from "./connectors";
import { canonicalUrl, dedupeHash, externalJobId, portalFromUrl } from "./dedupe";
import { detectInjection, sanitizeLine, sanitizeText } from "./sanitize";
import { inferEmploymentType, inferWorkMode, type JobDraft } from "./sources/types";
import type { EvaluationDoc, JobDoc, PrefsDoc, UserDoc } from "../types";

const DAY = 86_400_000;

export async function findDuplicate(userId: string, j: { urlCanonical?: string; externalJobId?: string; dedupeHash: string }, excludeId?: string) {
  const or: Record<string, unknown>[] = [{ dedupeHash: j.dedupeHash }];
  if (j.urlCanonical) or.push({ urlCanonical: j.urlCanonical });
  if (j.externalJobId) or.push({ externalJobId: j.externalJobId });
  const q: Record<string, unknown> = { userId, $or: or };
  if (excludeId) q._id = { $ne: excludeId };
  return (await cols.jobs()).findOne(q);
}

export async function ingestDrafts(user: UserDoc, cipher: UserCipher, drafts: JobDraft[]) {
  const jobs = await cols.jobs();
  const created: string[] = [];
  const duplicates: { title: string; company: string; existingId: string }[] = [];
  for (const d of drafts.slice(0, 100)) {
    const title = sanitizeLine(d.title) || "Untitled role";
    const company = sanitizeLine(d.company) || "Unknown company";
    const description = sanitizeText(d.description ?? "");
    const url = d.url && /^https?:\/\//i.test(d.url) ? d.url.slice(0, 2000) : undefined;
    const urlCanonical = canonicalUrl(url);
    const extId = d.externalJobId ?? externalJobId(url);
    const hash = dedupeHash(company, title);
    const dup = await findDuplicate(user._id, { urlCanonical, externalJobId: extId, dedupeHash: hash });
    if (dup) {
      duplicates.push({ title, company, existingId: dup._id });
      continue;
    }
    const injectionSignals = detectInjection(`${title}\n${company}\n${description}`);
    const job: JobDoc = {
      _id: newId(),
      userId: user._id,
      portal: d.portal === "other" && url ? portalFromUrl(url) : d.portal,
      source: d.source,
      externalJobId: extId,
      url,
      urlCanonical,
      title,
      company,
      location: sanitizeLine(d.location ?? ""),
      workMode: d.workMode && d.workMode !== "unknown" ? d.workMode : inferWorkMode(`${d.location ?? ""} ${description.slice(0, 800)}`),
      experienceText: d.experienceText ? sanitizeLine(d.experienceText) : undefined,
      salaryText: d.salaryText ? sanitizeLine(d.salaryText) : undefined,
      employmentType: d.employmentType ?? inferEmploymentType(description.slice(0, 1500)),
      descriptionSanitized: description,
      applyEmail: d.applyEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.applyEmail) ? d.applyEmail.toLowerCase() : undefined,
      deadline: d.deadline,
      injectionFlag: injectionSignals.length > 0,
      injectionSignals,
      dedupeHash: hash,
      status: "Discovered",
      discoveredAt: new Date(),
    };
    await jobs.insertOne(job);
    created.push(job._id);
    await audit({ userId: user._id, actor: "system", action: "job_discovered", entity: "job", entityId: job._id, details: { portal: job.portal, source: job.source } });
    if (job.injectionFlag) {
      await securityEvent({ userId: user._id, type: "prompt_injection_detected", severity: "medium", details: { jobId: job._id, signals: injectionSignals } });
    }
    await evaluateJob(user, cipher, job._id);
  }
  return { created, duplicates };
}

export async function capCounts(userId: string, company: string) {
  const apps = await cols.applications();
  const now = Date.now();
  const recent = await apps.find({ userId, approvedAt: { $gte: new Date(now - DAY) } }).project<{ approvedAt: Date; company: string }>({ approvedAt: 1, company: 1 }).toArray();
  return {
    today: recent.length,
    lastHour: recent.filter((a) => new Date(a.approvedAt).getTime() >= now - 3_600_000).length,
    companyToday: recent.filter((a) => a.company.toLowerCase() === company.toLowerCase()).length,
  };
}

export async function previouslyRejected(userId: string, hash: string, excludeJobId: string) {
  const sameJobs = await (await cols.jobs()).find({ userId, dedupeHash: hash, _id: { $ne: excludeJobId } }).project<{ _id: string }>({ _id: 1 }).toArray();
  if (!sameJobs.length) return false;
  return (await (await cols.applications()).countDocuments({ userId, jobId: { $in: sameJobs.map((j) => j._id) }, status: "Rejected" })) > 0;
}

export async function evaluateJob(user: UserDoc, cipher: UserCipher, jobId: string): Promise<EvaluationDoc | null> {
  const jobs = await cols.jobs();
  const job = await jobs.findOne({ _id: jobId, userId: user._id });
  if (!job) return null;
  const [facts, prefs, profile, resumes] = await Promise.all([
    listFacts(user._id, cipher, true),
    (await cols.prefs()).findOne({ _id: user._id }) as Promise<PrefsDoc>,
    (await cols.profiles()).findOne({ _id: user._id }),
    (await cols.resumes()).find({ userId: user._id }).toArray(),
  ]);

  const base = baselineScore(
    { ...job, description: job.descriptionSanitized },
    facts,
    prefs,
    profile?.plain.preferredLocations ?? [],
  );
  const resume = pickResume(resumes, { title: job.title, description: job.descriptionSanitized });
  const flags = new Set(base.riskFlags);
  if (!resume) flags.add("NO_APPROVED_RESUME");

  const guardrailNotes: string[] = [];
  let ai: Awaited<ReturnType<typeof llmEvaluate>> = null;
  if (job.injectionFlag) guardrailNotes.push("AI analysis skipped: job text contains prompt-injection patterns.");
  else if (job.descriptionSanitized.length < 200) guardrailNotes.push("AI analysis skipped: description missing or too short.");
  else ai = await llmEvaluate(user._id, facts, { ...job, description: job.descriptionSanitized });
  if (!ai && !guardrailNotes.length) guardrailNotes.push("AI unavailable — deterministic score only.");
  if (ai) guardrailNotes.push(...ai.notes);

  const sub = { ...base.subScores };
  let matchScore = base.overall;
  if (ai) {
    // Numeric, rule-checkable dimensions stay deterministic; semantic ones are blended.
    sub.skills = Math.round((base.subScores.skills + ai.raw.sub_scores.skills) / 2);
    sub.industry = Math.round((base.subScores.industry + ai.raw.sub_scores.industry) / 2);
    sub.education = Math.round((base.subScores.education + ai.raw.sub_scores.education) / 2);
    matchScore = Math.round(0.5 * base.overall + 0.5 * ai.raw.match_score);
    if (flags.has("REQUIRES_MORE_EXPERIENCE")) matchScore = Math.min(matchScore, base.overall + 10);
    for (const f of ai.flags) if (f !== "INFORMATION_NOT_AVAILABLE") flags.add(f === "SUSPICIOUS_POSTING" ? "SUSPICIOUS_POSTING:ai" : f);
  }

  const strong = [...base.strongMatches];
  for (const s of ai?.strong ?? []) if (!strong.some((x) => x.requirement.toLowerCase() === s.requirement.toLowerCase())) strong.push(s);
  const lacks = [...base.userLacks, ...(ai?.lacks ?? []).filter((l) => !base.userLacks.some((b) => b.requirement === l.requirement))];
  const notFound = [...new Set([...base.notFoundInProfile, ...(ai?.notFound ?? [])])].filter((n) => !strong.some((s) => s.requirement.toLowerCase() === n.toLowerCase()));

  const dup = await findDuplicate(user._id, job, job._id);
  const policy = decide({
    matchScore,
    riskFlags: [...flags],
    llmRecommendation: ai?.raw.recommendation,
    prefs,
    connector: connectorPolicy(job.portal, job.applyEmail),
    duplicate: !!dup,
    previouslyRejected: await previouslyRejected(user._id, job.dedupeHash, job._id),
    counts: await capCounts(user._id, job.company),
  });

  const ev: EvaluationDoc = {
    _id: newId(),
    userId: user._id,
    jobId: job._id,
    model: ai ? llm().model : "none",
    promptVersion: PROMPT_VERSION,
    aiAvailable: !!ai,
    matchScore,
    baselineScore: base.overall,
    llmScore: ai?.raw.match_score,
    subScores: sub,
    strongMatches: strong,
    notFoundInProfile: notFound,
    userLacks: lacks,
    riskFlags: [...flags],
    llmRecommendation: ai?.raw.recommendation,
    llmReason: ai?.raw.reason?.slice(0, 400),
    policyDecision: policy.decision,
    policyRules: policy.rules,
    guardrailNotes,
    recommendedResumeId: resume?._id,
    createdAt: new Date(),
  };
  await (await cols.evaluations()).insertOne(ev);
  const terminal = ["Approved", "Dismissed"].includes(job.status);
  const status = STATUS_FOR[policy.decision];
  await jobs.updateOne(
    { _id: job._id },
    { $set: { latestEvaluationId: ev._id, matchScore, decision: policy.decision, ...(terminal ? {} : { status, statusReason: policy.rules.filter((r) => !r.passed).map((r) => r.rule).join("; ") }) } },
  );
  await audit({ userId: user._id, actor: "ai", action: "job_evaluated", entity: "job", entityId: job._id, details: { matchScore, decision: policy.decision, aiAvailable: !!ai, model: ev.model } });
  if (!terminal && matchScore >= prefs.notifications.highMatchThreshold && policy.decision !== "SKIP") {
    await notify(user._id, "high_match", `High match: ${job.title}`, `${job.company} · ${matchScore}/100`, `/jobs/${job._id}`);
  }
  if (!terminal && policy.decision === "MANUAL") {
    await notify(user._id, "action_required", `Action required: ${job.title}`, policy.rules.find((r) => r.outcome === "MANUAL")?.detail ?? "", `/jobs/${job._id}`);
  }
  return ev;
}
