import { CERTIFICATIONS, SKILLS, termsIn } from "./vocab";
import { detectSuspicious } from "../jobs/sanitize";
import type { Fact, PrefsDoc, ResumeDoc } from "../types";

// Deterministic scoring. It runs for every job whether or not the LLM is available, and the
// numeric comparisons here (experience, salary, location) always override the LLM.

export interface JobForScoring {
  title: string;
  company: string;
  location: string;
  description: string;
  workMode?: string;
  employmentType?: string;
  experienceText?: string;
  salaryText?: string;
  portal: string;
  injectionFlag: boolean;
  source?: string;
}

export interface Baseline {
  overall: number;
  subScores: { skills: number; experience: number; location: number; industry: number; education: number };
  strongMatches: { requirement: string; factIds: string[] }[];
  notFoundInProfile: string[];
  userLacks: { requirement: string; factIds: string[] }[];
  riskFlags: string[];
  requiredExperience?: { min: number; max?: number };
  userYears?: number;
  salaryLpa?: { min: number; max: number };
  titleMatch: boolean;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const lc = (s: string) => s.toLowerCase();

export function parseExperience(text: string): { min: number; max?: number } | undefined {
  const t = text.replace(/\u2013|\u2014/g, "-");
  // Take whichever requirement appears first in the text.
  const cands: { idx: number; v: { min: number; max?: number } }[] = [];
  const range = /(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i.exec(t);
  if (range) cands.push({ idx: range.index, v: { min: Number(range[1]), max: Number(range[2]) } });
  const plus = /(?:minimum|min\.?|at least|over)?\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+\w+){0,4}\s+(?:experience|exp)/i.exec(t)
    ?? /(?:experience|exp)[^.\n]{0,30}?(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i.exec(t);
  if (plus) cands.push({ idx: plus.index, v: { min: Number(plus[1]) } });
  cands.sort((a, b) => a.idx - b.idx);
  return cands[0]?.v;
}

export function parseSalaryLpa(text: string): { min: number; max: number } | undefined {
  const t = text.replace(/,/g, "");
  const lpa = t.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?|l\b)/i);
  if (lpa) return { min: Number(lpa[1]), max: Number(lpa[2]) };
  const single = t.match(/(?:upto|up to|max)\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?)/i);
  if (single) return { min: 0, max: Number(single[1]) };
  const inr = t.match(/(?:₹|inr|rs\.?)\s*(\d{6,9})\s*(?:-|to)\s*(?:₹|inr|rs\.?)?\s*(\d{6,9})/i);
  if (inr) return { min: Number(inr[1]) / 1e5, max: Number(inr[2]) / 1e5 };
  return undefined;
}

function factText(f: Fact) {
  return `${f.label} ${f.value}`;
}

export function userTerms(facts: Fact[], vocab: Record<string, RegExp>) {
  const map = new Map<string, string[]>();
  for (const f of facts) {
    if (!f.verified) continue;
    for (const t of termsIn(factText(f), vocab)) map.set(t, [...(map.get(t) ?? []), f.factId]);
  }
  return map;
}

export function totalYears(facts: Fact[]): { years?: number; factId?: string } {
  const exp = facts.filter((f) => f.verified && f.category === "experience_years" && typeof f.valueNumeric === "number");
  const total = exp.find((f) => /total|overall/i.test(f.label)) ?? exp.sort((a, b) => (b.valueNumeric ?? 0) - (a.valueNumeric ?? 0))[0];
  return { years: total?.valueNumeric, factId: total?.factId };
}

function tokens(s: string) {
  return new Set(lc(s).split(/[^a-z0-9+]+/).filter((w) => w.length > 2 && !["and", "the", "senior", "junior", "lead", "manager", "analyst"].includes(w)));
}

export function titleSimilarity(a: string, b: string) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let n = 0;
  for (const w of ta) if (tb.has(w)) n++;
  return n / Math.min(ta.size, tb.size);
}

export function baselineScore(job: JobForScoring, facts: Fact[], prefs: PrefsDoc, preferredLocations: string[]): Baseline {
  const text = `${job.title}\n${job.description}\n${job.experienceText ?? ""}`;
  const flags = new Set<string>();
  const strong: Baseline["strongMatches"] = [];
  const notFound: string[] = [];
  const lacks: Baseline["userLacks"] = [];

  // Skills and certifications
  const jobSkills = termsIn(text, SKILLS);
  const jobCerts = termsIn(text, CERTIFICATIONS);
  const uSkills = userTerms(facts, SKILLS);
  // Only facts in the Certification category count as holding a certification.
  const uCerts = userTerms(facts.filter((f) => f.category === "certification"), CERTIFICATIONS);
  let matched = 0;
  for (const s of jobSkills) {
    if (uSkills.has(s)) { matched++; strong.push({ requirement: s, factIds: uSkills.get(s)! }); }
    else notFound.push(s);
  }
  for (const c of jobCerts) {
    if (uCerts.has(c)) { matched++; strong.push({ requirement: c, factIds: uCerts.get(c)! }); }
    else { notFound.push(c); flags.add("CERTIFICATION_NOT_IN_PROFILE"); }
  }
  const required = jobSkills.length + jobCerts.length;
  const skills = required ? clamp((matched / required) * 100) : 60;

  // Experience (numeric, deterministic)
  const req = parseExperience(text);
  const { years, factId } = totalYears(facts);
  let experience = 70;
  if (req) {
    if (years === undefined) {
      notFound.push("Total years of experience");
      experience = 50;
    } else if (years >= req.min) {
      experience = 100;
      strong.push({ requirement: `${req.min}+ years experience`, factIds: factId ? [factId] : [] });
    } else {
      experience = clamp(100 - (req.min - years) * 25);
      lacks.push({ requirement: `${req.min}+ years experience (profile: ${years})`, factIds: factId ? [factId] : [] });
      flags.add("REQUIRES_MORE_EXPERIENCE");
    }
    if (req.min > prefs.experienceMax || (req.max !== undefined && req.max < prefs.experienceMin)) flags.add("EXPERIENCE_OUT_OF_RANGE");
  }

  // Location / work mode
  const locs = [...new Set([...prefs.preferredLocations, ...preferredLocations].map(lc).filter(Boolean))];
  const jl = lc(`${job.location} ${job.workMode ?? ""}`);
  const wm = (job.workMode ?? "unknown") as "remote" | "hybrid" | "onsite" | "unknown";
  let location = 70;
  if (wm === "remote" && prefs.workModes.includes("remote")) location = 100;
  else if (locs.length && locs.some((l) => jl.includes(l) || l.includes(lc(job.location || "~")))) location = 100;
  else if (locs.length && job.location) { location = 30; flags.add("REQUIRES_RELOCATION"); }
  if (wm !== "unknown" && !prefs.workModes.includes(wm)) flags.add("WORK_MODE_MISMATCH");

  // Industry
  const indPrefs = prefs.preferredIndustries.map(lc).filter(Boolean);
  const indFacts = facts.filter((f) => f.verified && f.category === "industry").map((f) => lc(f.label));
  const lt = lc(text + " " + job.company);
  const industry = indPrefs.some((i) => lt.includes(i)) ? 100 : indFacts.some((i) => lt.includes(i)) ? 90 : indPrefs.length ? 50 : 70;

  // Education
  const wantsDegree = /\b(bachelor'?s?|b\.?\s?tech|b\.?e\.|b\.?sc|master'?s?|m\.?\s?tech|mba|degree|graduate)\b/i.test(text);
  const eduFacts = facts.filter((f) => f.verified && f.category === "education");
  let education = 80;
  if (wantsDegree) {
    if (eduFacts.length) { education = 90; strong.push({ requirement: "Degree requirement", factIds: eduFacts.map((f) => f.factId) }); }
    else { education = 50; notFound.push("Education details"); }
  }

  // Preference and safety flags
  for (const kw of prefs.excludedKeywords) if (kw && lt.includes(lc(kw))) flags.add(`EXCLUDED_KEYWORD:${kw}`);
  for (const co of prefs.excludedCompanies) if (co && lc(job.company).includes(lc(co))) flags.add(`EXCLUDED_COMPANY:${co}`);
  const sal = parseSalaryLpa(`${job.salaryText ?? ""} ${job.description}`);
  if (sal && prefs.salaryMinLpa > 0 && sal.max < prefs.salaryMinLpa) flags.add("SALARY_BELOW_PREFERENCE");
  const et = job.employmentType;
  if (et && !prefs.employmentTypes.includes(et as PrefsDoc["employmentTypes"][number])) flags.add(et === "contract" ? "CONTRACT_ROLE" : "EMPLOYMENT_TYPE_MISMATCH");
  for (const s of detectSuspicious(text)) flags.add(`SUSPICIOUS_POSTING:${s}`);
  if (job.injectionFlag) flags.add("PROMPT_INJECTION_DETECTED");
  if (job.portal === "company" || job.portal === "other") flags.add("EXTERNAL_APPLICATION");

  const titleMatch = !prefs.targetTitles.length || prefs.targetTitles.some((t) => titleSimilarity(t, job.title) >= 0.5);
  if (job.description.trim().length < 200) {
    // Alert emails and job feeds often carry only a title. A matching title goes to your approval
    // queue as "title only"; a pasted job without a description asks you to paste it.
    if (job.source && job.source !== "manual") {
      if (titleMatch) flags.add("TITLE_ONLY");
    } else flags.add("MISSING_DESCRIPTION");
  }
  let overall = skills * 0.4 + experience * 0.25 + location * 0.15 + industry * 0.1 + education * 0.1;
  if (!titleMatch) overall *= 0.85;
  if (prefs.keywords.length && !prefs.keywords.some((k) => k && lt.includes(lc(k)))) overall *= 0.9;

  return {
    overall: clamp(overall),
    subScores: { skills, experience, location, industry, education },
    strongMatches: strong,
    notFoundInProfile: [...new Set(notFound)],
    userLacks: lacks,
    riskFlags: [...flags],
    requiredExperience: req,
    userYears: years,
    salaryLpa: sal,
    titleMatch,
  };
}

const DOMAIN = /\b(grc|governance|risk|compliance|security|cyber|infosec|iso ?27001|soc ?2|audit|auditor|privacy|data protection|iam|identity|access management|third[- ]party|vendor risk|trust)\b/i;

/** Cheap pre-filter used by automatic sources so only plausibly relevant jobs are stored and scored. */
export function isRelevantTitle(title: string, prefs: Pick<PrefsDoc, "targetTitles" | "keywords" | "excludedKeywords">): boolean {
  const t = title.toLowerCase();
  if (prefs.excludedKeywords.some((k) => k && t.includes(k.toLowerCase()))) return false;
  if (prefs.targetTitles.some((x) => titleSimilarity(x, title) >= 0.5)) return true;
  if (prefs.keywords.some((k) => k && t.includes(k.toLowerCase()))) return true;
  return DOMAIN.test(title);
}

export function pickResume(resumes: ResumeDoc[], job: { title: string; description: string }): ResumeDoc | undefined {
  const approved = resumes.filter((r) => r.approved && r.scanStatus === "clean");
  if (!approved.length) return undefined;
  const jt = lc(`${job.title} ${job.title} ${job.description.slice(0, 3000)}`);
  let best: ResumeDoc | undefined, bestScore = -1;
  for (const r of approved) {
    const words = [...r.focusKeywords, ...r.label.split(/\s+/)].map(lc).filter((w) => w.length > 2 && w !== "resume");
    const s = words.reduce((n, w) => n + (jt.includes(w) ? 1 : 0), 0);
    if (s > bestScore) { best = r; bestScore = s; }
  }
  return best;
}
