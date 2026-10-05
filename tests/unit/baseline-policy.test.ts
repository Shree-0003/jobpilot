import { describe, expect, it } from "vitest";
import { baselineScore, parseExperience, parseSalaryLpa, pickResume } from "@/lib/ai/baseline";
import { decide, type PolicyInput } from "@/lib/policy/engine";
import { connectorPolicy } from "@/lib/jobs/connectors";
import { FACTS, prefs } from "./fixtures";

const JD = `We are hiring a GRC Analyst in Bengaluru. Requirements: 2-4 years of experience in ISO 27001 audits,
SOC 2, risk assessments and third-party risk management. Bachelor's degree required. Hybrid work.`;
const job = (over = {}) => ({ title: "GRC Analyst", company: "Acme", location: "Bengaluru", description: JD + " ".repeat(10) + JD, workMode: "hybrid", portal: "linkedin", injectionFlag: false, ...over });

describe("parsers", () => {
  it("parses experience", () => {
    expect(parseExperience("3-6 Yrs")).toEqual({ min: 3, max: 6 });
    expect(parseExperience("5+ years of relevant experience")).toEqual({ min: 5 });
    expect(parseExperience("minimum 7 years experience in GRC")).toEqual({ min: 7 });
    expect(parseExperience("great team")).toBeUndefined();
  });
  it("parses salary", () => {
    expect(parseSalaryLpa("12-18 LPA")).toEqual({ min: 12, max: 18 });
    expect(parseSalaryLpa("₹ 6,00,000 - 9,00,000 P.A.")).toEqual({ min: 6, max: 9 });
    expect(parseSalaryLpa("competitive")).toBeUndefined();
  });
});

describe("baseline scorer", () => {
  it("scores a strong match high with fact citations", () => {
    const b = baselineScore(job(), FACTS, prefs(), []);
    expect(b.overall).toBeGreaterThanOrEqual(80);
    expect(b.strongMatches.find((m) => m.requirement === "ISO 27001")?.factIds).toContain("F001");
    expect(b.riskFlags).not.toContain("REQUIRES_MORE_EXPERIENCE");
  });
  it("flags more experience and records a cited contradiction", () => {
    const jd5 = JD.replace("2-4 years", "5+ years");
    const b = baselineScore(job({ description: jd5 + jd5 }), FACTS, prefs(), []);
    expect(b.riskFlags).toContain("REQUIRES_MORE_EXPERIENCE");
    expect(b.userLacks[0].factIds).toEqual(["F002"]);
  });
  it("treats a certification absent from facts as NOT FOUND, not lacking", () => {
    const b = baselineScore(job({ description: JD + " CISSP is mandatory. " + JD }), FACTS, prefs(), []);
    expect(b.notFoundInProfile).toContain("CISSP");
    expect(b.userLacks.map((l) => l.requirement).join()).not.toMatch(/CISSP/);
    expect(b.riskFlags).toContain("CERTIFICATION_NOT_IN_PROFILE");
  });
  it("ignores unverified facts (AI-proposed CISSP)", () => {
    const b = baselineScore(job({ description: JD + " CISSP required " + JD }), FACTS, prefs(), []);
    expect(b.strongMatches.some((m) => m.requirement === "CISSP")).toBe(false);
  });
  it("flags relocation, salary, contract, exclusions, scams, injection", () => {
    const b = baselineScore(
      job({ location: "Chennai", workMode: "onsite", employmentType: "contract", salaryText: "6-8 LPA", injectionFlag: true, description: JD + " Pay a registration fee to proceed. Night shift. " + JD }),
      FACTS, prefs({ excludedKeywords: ["night shift"], workModes: ["remote", "hybrid"] }), [],
    );
    for (const f of ["REQUIRES_RELOCATION", "SALARY_BELOW_PREFERENCE", "CONTRACT_ROLE", "EXCLUDED_KEYWORD:night shift", "SUSPICIOUS_POSTING:asks_for_payment", "PROMPT_INJECTION_DETECTED", "WORK_MODE_MISMATCH"]) {
      expect(b.riskFlags).toContain(f);
    }
  });
  it("flags missing description", () => expect(baselineScore(job({ description: "short" }), FACTS, prefs(), []).riskFlags).toContain("MISSING_DESCRIPTION"));
  it("picks the most relevant approved resume", () => {
    const base = { userId: "u", objectKey: "k", sha256: "", mime: "application/pdf" as const, size: 1, scanStatus: "clean" as const, createdAt: new Date() };
    const r = pickResume([
      { ...base, _id: "a", label: "Management Resume", focusKeywords: ["leadership"], approved: true },
      { ...base, _id: "b", label: "Security GRC Resume", focusKeywords: ["GRC", "ISO 27001", "risk"], approved: true },
      { ...base, _id: "c", label: "GRC Resume v2", focusKeywords: ["GRC", "ISO 27001", "risk", "audit"], approved: false },
    ], { title: "GRC Analyst", description: JD });
    expect(r?._id).toBe("b");
  });
});

describe("policy engine", () => {
  const base = (over: Partial<PolicyInput> = {}): PolicyInput => ({
    matchScore: 90, riskFlags: [], prefs: prefs({ autoApplyEnabled: true }),
    connector: { portal: "Email", autoSubmitAllowed: true, reviewExpires: "2099-01-01", configured: true },
    duplicate: false, previouslyRejected: false, counts: { today: 0, lastHour: 0, companyToday: 0 }, ...over,
  });
  it("allows AUTO_APPLY only when every rule passes", () => expect(decide(base()).decision).toBe("AUTO_APPLY"));
  it("defaults to approval mode", () => expect(decide(base({ prefs: prefs() })).decision).toBe("USER_APPROVAL"));
  it("LinkedIn and Naukri can never be auto-submitted", () => {
    expect(decide(base({ connector: connectorPolicy("linkedin") })).decision).toBe("USER_APPROVAL");
    expect(decide(base({ connector: connectorPolicy("naukri") })).decision).toBe("USER_APPROVAL");
  });
  it("email connector is not configured in the MVP", () => expect(decide(base({ connector: connectorPolicy("linkedin", "hr@acme.com") })).decision).toBe("USER_APPROVAL"));
  it("expired ToS review disables automation", () => expect(decide(base({ connector: { portal: "X", autoSubmitAllowed: true, reviewExpires: "2020-01-01", configured: true } })).decision).toBe("USER_APPROVAL"));
  it("below threshold is low relevance", () => expect(decide(base({ matchScore: 79 })).decision).toBe("LOW_RELEVANCE"));
  it("duplicates and exclusions are skipped", () => {
    expect(decide(base({ duplicate: true })).decision).toBe("SKIP");
    expect(decide(base({ riskFlags: ["EXCLUDED_COMPANY:Acme"] })).decision).toBe("SKIP");
    expect(decide(base({ previouslyRejected: true })).decision).toBe("SKIP");
  });
  it("injection, scams and missing description go to manual", () => {
    expect(decide(base({ riskFlags: ["PROMPT_INJECTION_DETECTED"] })).decision).toBe("MANUAL");
    expect(decide(base({ riskFlags: ["SUSPICIOUS_POSTING:asks_for_payment"] })).decision).toBe("MANUAL");
    expect(decide(base({ riskFlags: ["MISSING_DESCRIPTION"] })).decision).toBe("MANUAL");
  });
  it("important mismatches need approval", () => {
    for (const f of ["REQUIRES_MORE_EXPERIENCE", "REQUIRES_RELOCATION", "SALARY_BELOW_PREFERENCE", "CONTRACT_ROLE", "CERTIFICATION_NOT_IN_PROFILE"]) {
      expect(decide(base({ riskFlags: [f] })).decision).toBe("USER_APPROVAL");
    }
  });
  it("caps and emergency stop block automation", () => {
    expect(decide(base({ counts: { today: 20, lastHour: 0, companyToday: 0 } })).decision).toBe("USER_APPROVAL");
    expect(decide(base({ counts: { today: 0, lastHour: 5, companyToday: 0 } })).decision).toBe("USER_APPROVAL");
    expect(decide(base({ counts: { today: 0, lastHour: 0, companyToday: 3 } })).decision).toBe("USER_APPROVAL");
    expect(decide(base({ prefs: prefs({ autoApplyEnabled: true, automationState: "stopped" }) })).decision).toBe("USER_APPROVAL");
  });
  it("the LLM can tighten but never loosen the decision", () => {
    expect(decide(base({ llmRecommendation: "MANUAL" })).decision).toBe("MANUAL");
    const loosen = decide(base({ matchScore: 50, llmRecommendation: "AUTO_APPLY" }));
    expect(loosen.decision).toBe("LOW_RELEVANCE");
    expect(loosen.rules.at(-1)?.detail).toMatch(/rules are stricter/);
    expect(decide(base({ riskFlags: ["PROMPT_INJECTION_DETECTED"], llmRecommendation: "AUTO_APPLY" })).decision).toBe("MANUAL");
  });
  it("explains every rule", () => {
    const r = decide(base({ prefs: prefs() }));
    expect(r.rules.length).toBeGreaterThanOrEqual(11);
    expect(r.rules.every((x) => x.detail.length > 0)).toBe(true);
  });
});
