import { CERTIFICATIONS, SKILLS, termsIn } from "./vocab";
import { ALLOWED_LLM_FLAGS, type EvaluationOutputT } from "./schemas";
import { totalYears } from "./baseline";
import { SENSITIVE_FACT_CATEGORIES, type Fact } from "../types";

// ---------- Evaluation output ----------

export function guardEvaluation(out: EvaluationOutputT, facts: Fact[]) {
  const notes: string[] = [];
  const valid = new Map(facts.filter((f) => f.verified).map((f) => [f.factId, f]));
  const keepIds = (ids: string[]) => ids.filter((id) => valid.has(id));

  const strong = out.strong_matches
    .map((m) => ({ requirement: m.requirement, factIds: keepIds(m.fact_ids) }))
    .filter((m) => {
      if (!m.factIds.length) {
        notes.push(`Dropped uncited strong match "${m.requirement}"`);
        return false;
      }
      // A certification claim must be backed by a fact that names that certification.
      const certs = termsIn(m.requirement, CERTIFICATIONS);
      if (certs.length) {
        const backed = m.factIds.some((id) => valid.get(id)!.category === "certification" && termsIn(`${valid.get(id)!.label} ${valid.get(id)!.value}`, CERTIFICATIONS).some((c) => certs.includes(c)));
        if (!backed) {
          notes.push(`Dropped unsupported certification claim "${m.requirement}"`);
          return false;
        }
      }
      return true;
    });

  const notFound = [...out.not_found_in_profile];
  const lacks = out.user_lacks
    .map((l) => ({ requirement: l.requirement, factIds: keepIds(l.fact_ids) }))
    .filter((l) => {
      if (!l.factIds.length) {
        // "Not in profile" is not the same as "does not have".
        notFound.push(l.requirement);
        notes.push(`Moved "${l.requirement}" from lacks to not-found (no contradicting fact)`);
        return false;
      }
      return true;
    });

  const flags = out.risk_flags
    .map((f) => f.toUpperCase().trim())
    .filter((f) => {
      const ok = (ALLOWED_LLM_FLAGS as readonly string[]).includes(f);
      if (!ok) notes.push(`Ignored unknown flag "${f.slice(0, 40)}"`);
      return ok;
    });

  return { strong, lacks, notFound: [...new Set(notFound)], flags, notes };
}

// ---------- Application questions ----------

const SENSITIVE_TOPICS: [string, RegExp, string[]][] = [
  ["salary", /\b(salary|ctc|compensation|remuneration|pay (expectation|range)|expected pay|lpa|package)\b/i, ["expected_salary", "current_salary"]],
  ["notice_period", /\b(notice period|joining date|how soon can you (join|start)|earliest start|start date|available to start)\b/i, ["notice_period_days"]],
  ["relocation", /\b(relocat\w*|willing to (move|shift)|open to moving)\b/i, []],
  ["work_authorization", /\b(visa|work authori[sz]ation|authori[sz]ed to work|sponsor(ship)?|citizenship|right to work|work permit)\b/i, ["work_authorization"]],
  ["personal", /\b(date of birth|\bdob\b|your age|how old|home address|gender|marital|religion|caste|disabilit\w*|veteran|ethnicity|race|nationality|pronouns?)\b/i, []],
  ["legal", /\b(criminal|convicted|offen[cs]e|background check|litigation)\b/i, []],
];

export function classifyQuestion(q: string): { sensitive: boolean; topic?: string; factCategories: string[] } {
  for (const [topic, re, cats] of SENSITIVE_TOPICS) if (re.test(q)) return { sensitive: true, topic, factCategories: cats };
  return { sensitive: false, factCategories: [] };
}

export interface DraftAnswer {
  answer: string;
  factIds: string[];
  status: "drafted" | "human_review_required";
  reason?: string;
  sensitive: boolean;
}

/** Questions that code can answer exactly, or must hand to the user, without the LLM. */
export function deterministicAnswer(q: string, facts: Fact[]): DraftAnswer | null {
  const verified = facts.filter((f) => f.verified);
  const cls = classifyQuestion(q);
  if (cls.sensitive) {
    const f = verified.find((x) => cls.factCategories.includes(x.category));
    return {
      answer: f ? (typeof f.valueNumeric === "number" ? `${f.valueNumeric}${f.unit ? " " + f.unit : ""}` : f.value || f.label).trim() : "",
      factIds: f ? [f.factId] : [],
      status: "human_review_required",
      reason: f
        ? `Sensitive question (${cls.topic}). Pre-filled from ${f.factId}; confirm before use.`
        : `Sensitive question (${cls.topic}). Answer this yourself.`,
      sensitive: true,
    };
  }

  // "Do you have N+ years of experience (in X)?"
  const yrs = q.match(/\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i);
  if (yrs && /\b(do|does|have|has|are|possess)\b/i.test(q) && /experience|exp\b/i.test(q)) {
    const need = Number(yrs[1]);
    const domain = q.match(/experience (?:in|with|of)\s+([^?.,]+)/i)?.[1]?.trim();
    const expFacts = verified.filter((f) => f.category === "experience_years" && typeof f.valueNumeric === "number");
    let fact: Fact | undefined;
    if (domain) {
      const d = domain.toLowerCase();
      fact = expFacts.find((f) => !/total|overall/i.test(f.label) && d.split(/\s+/).some((w) => w.length > 2 && f.label.toLowerCase().includes(w)));
      if (!fact) {
        return {
          answer: "",
          factIds: [],
          status: "human_review_required",
          reason: `Your profile has no experience figure specifically for "${domain}". This is missing information, not a "No".`,
          sensitive: false,
        };
      }
    } else {
      const t = totalYears(verified);
      fact = expFacts.find((f) => f.factId === t.factId);
    }
    if (!fact) {
      return { answer: "", factIds: [], status: "human_review_required", reason: "Years of experience are not in your verified facts.", sensitive: false };
    }
    const have = fact.valueNumeric!;
    return {
      answer: have >= need ? `Yes — ${have} years (${fact.label}).` : `No — I have ${have} years (${fact.label}).`,
      factIds: [fact.factId],
      status: "drafted",
      reason: `Computed in code from ${fact.factId}: ${have} vs ${need} required.`,
      sensitive: false,
    };
  }

  // Certification questions
  const certsAsked = termsIn(q, CERTIFICATIONS);
  if (certsAsked.length && /\b(do you|have you|are you|certif)/i.test(q)) {
    const matches = verified.filter((f) => f.category === "certification" && termsIn(`${f.label} ${f.value}`, CERTIFICATIONS).some((c) => certsAsked.includes(c)));
    if (matches.length) {
      return { answer: `Yes — ${matches.map((m) => m.label).join("; ")}.`, factIds: matches.map((m) => m.factId), status: "drafted", reason: "Matched verified certification facts.", sensitive: false };
    }
    return {
      answer: "",
      factIds: [],
      status: "human_review_required",
      reason: `${certsAsked.join(", ")} not found in your verified facts. That does not mean you lack it — add it as a fact if you hold it.`,
      sensitive: false,
    };
  }
  return null;
}

const numbersIn = (s: string) => (s.match(/\b\d+(?:\.\d+)?\b/g) ?? []).map(Number);

/** Validates an LLM-drafted answer against the facts it cites. */
export function validateAnswer(answer: string, factIds: string[], facts: Fact[]): string[] {
  const problems: string[] = [];
  const byId = new Map(facts.map((f) => [f.factId, f]));
  if (!answer.trim()) problems.push("Empty answer.");
  if (!factIds.length) problems.push("Answer cites no facts.");
  const cited: Fact[] = [];
  for (const id of factIds) {
    const f = byId.get(id);
    if (!f) problems.push(`Cites unknown fact ${id}.`);
    else if (!f.verified) problems.push(`Cites unverified fact ${id}.`);
    else if (SENSITIVE_FACT_CATEGORIES.includes(f.category)) problems.push(`Cites sensitive fact ${id}.`);
    else cited.push(f);
  }
  const citedText = cited.map((f) => `${f.label} ${f.value} ${f.valueNumeric ?? ""}`).join(" ");
  const allowedNums = new Set(numbersIn(citedText));
  for (const n of numbersIn(answer)) if (!allowedNums.has(n)) problems.push(`Number ${n} is not in the cited facts.`);
  const citedCerts = new Set(termsIn(cited.filter((f) => f.category === "certification").map((f) => `${f.label} ${f.value}`).join(" "), CERTIFICATIONS));
  for (const c of termsIn(answer, CERTIFICATIONS)) if (!citedCerts.has(c)) problems.push(`Mentions ${c}, which no cited fact supports.`);
  const allFactText = facts.filter((f) => f.verified).map((f) => `${f.label} ${f.value}`).join(" ");
  const knownSkills = new Set(termsIn(allFactText, SKILLS));
  for (const s of termsIn(answer, SKILLS)) if (!knownSkills.has(s)) problems.push(`Mentions ${s}, which is not in your facts.`);
  return problems;
}

// ---------- Cover letters ----------

export function validateCoverLetter(text: string, facts: Fact[]): string[] {
  const flags: string[] = [];
  const verified = facts.filter((f) => f.verified);
  const ft = verified.map((f) => `${f.label} ${f.value}`).join(" ");
  const certs = new Set(termsIn(verified.filter((f) => f.category === "certification").map((f) => `${f.label} ${f.value}`).join(" "), CERTIFICATIONS));
  for (const c of termsIn(text, CERTIFICATIONS)) if (!certs.has(c)) flags.push(`Mentions ${c}, which is not in your verified facts.`);
  const yrs = new Set(verified.filter((f) => f.category === "experience_years").map((f) => f.valueNumeric));
  for (const m of text.matchAll(/\b(\d{1,2})\+?\s*(?:years?|yrs?)\b/gi)) if (!yrs.has(Number(m[1]))) flags.push(`Claims ${m[1]} years, which does not match your experience facts.`);
  if (/@|\+?\d[\d\s-]{9,}/.test(text)) flags.push("Contains what looks like contact details; the app adds those itself.");
  return [...new Set(flags)];
}

export function fallbackCoverLetter(facts: Fact[], job: { title: string; company: string }, tone: "formal" | "professional" | "short" | "technical"): string {
  const v = facts.filter((f) => f.verified && !SENSITIVE_FACT_CATEGORIES.includes(f.category));
  const yrs = totalYears(v);
  const certs = v.filter((f) => f.category === "certification").map((f) => f.label);
  const skills = v.filter((f) => f.category === "skill").map((f) => f.label).slice(0, tone === "short" ? 3 : 6);
  const title = v.find((f) => f.category === "job_title")?.label;
  const lines = [
    tone === "formal" ? "Dear Hiring Manager," : "Hello,",
    "",
    `I am writing to apply for the ${job.title} role at ${job.company}.` +
      (title ? ` I currently work as ${title}.` : "") +
      (yrs.years !== undefined ? ` I have ${yrs.years} years of experience.` : ""),
  ];
  if (skills.length) lines.push("", `My work covers ${skills.join(", ")}.`);
  if (certs.length) lines.push(`I hold ${certs.join(", ")}.`);
  if (tone !== "short") lines.push("", `I would welcome the chance to discuss how this experience fits the needs of ${job.company}.`);
  lines.push("", tone === "formal" ? "Yours sincerely," : "Best regards,");
  return lines.join("\n");
}
