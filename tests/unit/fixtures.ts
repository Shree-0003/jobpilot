import type { Fact, PrefsDoc } from "@/lib/types";
import { defaultPrefs } from "@/lib/defaults";

const f = (factId: string, category: Fact["category"], label: string, extra: Partial<Fact> = {}): Fact => ({
  factId, category, label, value: "", verified: true, source: "user", version: 1, updatedAt: "2026-10-01T00:00:00Z", ...extra,
});

export const FACTS: Fact[] = [
  f("F001", "certification", "ISO/IEC 27001 Lead Auditor", { value: "PECB, 2023" }),
  f("F002", "experience_years", "Total experience", { valueNumeric: 3, unit: "years" }),
  f("F003", "skill", "Risk assessment"),
  f("F004", "skill", "SOC 2 and ISO 27001 audits"),
  f("F005", "skill", "Third-party risk management (vendor risk)"),
  f("F006", "education", "B.Tech Computer Science", { value: "VIT, 2021" }),
  f("F007", "expected_salary", "Expected CTC", { valueNumeric: 18, unit: "LPA" }),
  f("F008", "job_title", "Information Security Analyst"),
  f("F009", "experience_years", "GRC experience", { valueNumeric: 2, unit: "years" }),
  f("F010", "certification", "CISSP (draft)", { verified: false, source: "ai_proposed" }),
];

export function prefs(over: Partial<PrefsDoc> = {}): PrefsDoc {
  return { ...defaultPrefs("u1"), preferredLocations: ["Bengaluru"], targetTitles: ["GRC Analyst", "Information Security Analyst"], salaryMinLpa: 12, ...over };
}
