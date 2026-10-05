import type { PolicyDecision, PrefsDoc, Recommendation, RuleResult } from "../types";

/**
 * Deterministic policy engine. Pure function, no I/O, fully unit-tested.
 * The LLM's recommendation is an input; it can make the outcome MORE restrictive, never less.
 */
export const POLICY_VERSION = "policy-2026-10-01";

const ORDER: PolicyDecision[] = ["AUTO_APPLY", "USER_APPROVAL", "MANUAL", "LOW_RELEVANCE", "SKIP"];
const rank = (d: PolicyDecision) => ORDER.indexOf(d);
export const mostRestrictive = (a: PolicyDecision, b: PolicyDecision) => (rank(a) >= rank(b) ? a : b);

export const REVIEW_FLAGS = [
  "REQUIRES_MORE_EXPERIENCE",
  "EXPERIENCE_OUT_OF_RANGE",
  "REQUIRES_RELOCATION",
  "SALARY_BELOW_PREFERENCE",
  "CONTRACT_ROLE",
  "EMPLOYMENT_TYPE_MISMATCH",
  "CERTIFICATION_NOT_IN_PROFILE",
  "WORK_MODE_MISMATCH",
  "NO_APPROVED_RESUME",
  "EXTERNAL_APPLICATION",
  "TITLE_ONLY",
];

export interface ConnectorPolicy {
  portal: string;
  autoSubmitAllowed: boolean; // from the recorded ToS review
  reviewExpires: string; // ISO date
  configured: boolean;
}

export interface PolicyInput {
  matchScore: number;
  riskFlags: string[];
  llmRecommendation?: Recommendation;
  prefs: Pick<PrefsDoc, "limits" | "autoApplyEnabled" | "automationState" | "excludePreviouslyRejected">;
  connector: ConnectorPolicy;
  duplicate: boolean;
  previouslyRejected: boolean;
  counts: { today: number; lastHour: number; companyToday: number };
  now?: Date;
}

export function decide(i: PolicyInput): { decision: PolicyDecision; rules: RuleResult[] } {
  const rules: RuleResult[] = [];
  const add = (rule: string, passed: boolean, detail: string, outcome: PolicyDecision) =>
    rules.push({ rule, passed, detail, outcome: passed ? undefined : outcome });
  const now = i.now ?? new Date();
  const L = i.prefs.limits;

  add("Not a duplicate", !i.duplicate, i.duplicate ? "Same URL, job ID or company + title already in your register" : "No earlier copy found", "SKIP");
  const excluded = i.riskFlags.filter((f) => f.startsWith("EXCLUDED_"));
  add("Outside excluded keywords and companies", !excluded.length, excluded.length ? excluded.join(", ") : "No exclusions hit", "SKIP");
  add(
    "Not previously rejected",
    !(i.previouslyRejected && i.prefs.excludePreviouslyRejected),
    i.previouslyRejected ? "You were rejected for this company and title before" : "No earlier rejection",
    "SKIP",
  );
  const titleOnly = i.riskFlags.includes("TITLE_ONLY");
  add(
    `Match score at least ${L.minMatchScore}`,
    titleOnly || i.matchScore >= L.minMatchScore,
    titleOnly ? `Title matches your target roles; no description yet (title-only score ${i.matchScore})` : `Score ${i.matchScore}`,
    "LOW_RELEVANCE",
  );

  const injection = i.riskFlags.includes("PROMPT_INJECTION_DETECTED");
  add("No prompt-injection content", !injection, injection ? "Job text contains instructions aimed at the AI" : "None detected", "MANUAL");
  const suspicious = i.riskFlags.filter((f) => f.startsWith("SUSPICIOUS_POSTING"));
  add("Posting looks legitimate", !suspicious.length, suspicious.length ? suspicious.join(", ") : "No scam signals", "MANUAL");
  const missing = i.riskFlags.includes("MISSING_DESCRIPTION");
  add("Full job description available", !missing, missing ? "Paste the full description to complete scoring" : "Description present", "MANUAL");

  const review = i.riskFlags.filter((f) => REVIEW_FLAGS.includes(f));
  add("No mismatches needing your judgement", !review.length, review.length ? review.join(", ") : "None", "USER_APPROVAL");

  add("Automation running", i.prefs.automationState === "running", `State: ${i.prefs.automationState}`, "USER_APPROVAL");
  add("Auto Apply enabled by you", i.prefs.autoApplyEnabled, i.prefs.autoApplyEnabled ? "Enabled" : "Approval Required mode (default)", "USER_APPROVAL");

  const reviewValid = new Date(i.connector.reviewExpires).getTime() > now.getTime();
  const canAuto = i.connector.autoSubmitAllowed && reviewValid && i.connector.configured;
  add(
    "Portal permits automated submission",
    canAuto,
    !i.connector.autoSubmitAllowed
      ? `${i.connector.portal}: terms require you to submit yourself`
      : !reviewValid
        ? `${i.connector.portal}: ToS review expired ${i.connector.reviewExpires}`
        : !i.connector.configured
          ? `${i.connector.portal}: connector not configured`
          : "Allowed",
    "USER_APPROVAL",
  );

  const capOk = i.counts.today < L.maxPerDay && i.counts.lastHour < L.maxPerHour && i.counts.companyToday < L.maxPerCompanyPerDay;
  add(
    "Within daily, hourly and per-company caps",
    capOk,
    `today ${i.counts.today}/${L.maxPerDay}, hour ${i.counts.lastHour}/${L.maxPerHour}, company ${i.counts.companyToday}/${L.maxPerCompanyPerDay}`,
    "USER_APPROVAL",
  );

  let decision: PolicyDecision = "AUTO_APPLY";
  for (const r of rules) if (!r.passed && r.outcome) decision = mostRestrictive(decision, r.outcome);

  if (i.llmRecommendation) {
    const llm: PolicyDecision = i.llmRecommendation === "SKIP" ? "LOW_RELEVANCE" : i.llmRecommendation;
    const tighter = rank(llm) > rank(decision);
    rules.push({
      rule: "AI recommendation (advisory)",
      passed: !tighter,
      detail: tighter
        ? `AI suggested ${i.llmRecommendation}; outcome tightened`
        : rank(llm) < rank(decision)
          ? `AI suggested ${i.llmRecommendation}; rules are stricter and win`
          : `AI suggested ${i.llmRecommendation}`,
      outcome: tighter ? llm : undefined,
    });
    if (tighter) decision = mostRestrictive(decision, llm);
  }
  return { decision, rules };
}

export const STATUS_FOR: Record<PolicyDecision, "Shortlisted" | "Awaiting Approval" | "Manual Action Required" | "Low Relevance" | "Skipped"> = {
  AUTO_APPLY: "Shortlisted",
  USER_APPROVAL: "Awaiting Approval",
  MANUAL: "Manual Action Required",
  LOW_RELEVANCE: "Low Relevance",
  SKIP: "Skipped",
};
