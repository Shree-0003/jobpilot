import type { JobSource, Portal } from "../../types";

export interface JobDraft {
  portal: Portal;
  source: JobSource;
  url?: string;
  externalJobId?: string;
  title: string;
  company: string;
  location: string;
  description: string;
  workMode?: "remote" | "hybrid" | "onsite" | "unknown";
  employmentType?: string;
  salaryText?: string;
  experienceText?: string;
  applyEmail?: string;
  deadline?: string;
}

export function inferWorkMode(text: string): JobDraft["workMode"] {
  const t = text.toLowerCase();
  if (/\b(fully remote|remote[- ]first|work from home|wfh|100% remote)\b/.test(t) || /^\s*remote\b/.test(t)) return "remote";
  if (/\bhybrid\b/.test(t)) return "hybrid";
  if (/\b(on-?site|in[- ]office|work from office|wfo)\b/.test(t)) return "onsite";
  if (/\bremote\b/.test(t)) return "remote";
  return "unknown";
}

export function inferEmploymentType(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/\b(contract|contractual|c2h|contract[- ]to[- ]hire|fixed[- ]term)\b/.test(t)) return "contract";
  if (/\bintern(ship)?\b/.test(t)) return "internship";
  if (/\bpart[- ]time\b/.test(t)) return "part-time";
  if (/\b(full[- ]time|permanent)\b/.test(t)) return "full-time";
  return undefined;
}
