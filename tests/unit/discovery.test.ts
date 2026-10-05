import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ default: { lookup: vi.fn(async () => [{ address: "52.1.2.3", family: 4 }]) } }));

import { parseAlertEmail } from "@/lib/jobs/sources/alertEmail";
import { isRelevantTitle, baselineScore } from "@/lib/ai/baseline";
import { decide } from "@/lib/policy/engine";
import { connectorPolicy } from "@/lib/jobs/connectors";
import { FACTS, prefs } from "./fixtures";

const LINKEDIN_HTML = `<table><tr><td><a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&amp;refId=x"><img alt="Acme"></a></td>
<td><a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc">Senior GRC Analyst</a><p>Acme Fintech · Bengaluru, Karnataka, India</p><p>Actively recruiting</p></td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/view/4012345679/">Third Party Risk Analyst</a><p>Northwind Bank · Pune, Maharashtra, India</p></td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/search/?keywords=grc">See all jobs</a></td></tr></table>`;
const NAUKRI_HTML = `<div><a href="https://www.naukri.com/job-listings-information-security-analyst-contoso-mumbai-3-to-6-years-011025500123?src=jobalert"><b>Information Security Analyst</b></a><div>Contoso Technologies Pvt Ltd</div><div>3-6 Yrs | Mumbai</div></div>`;

describe("HTML alert emails", () => {
  it("LinkedIn: title from link text, company and location after it", () => {
    expect(parseAlertEmail(LINKEDIN_HTML).map((d) => [d.title, d.company, d.location, d.externalJobId])).toEqual([
      ["Senior GRC Analyst", "Acme Fintech", "Bengaluru, Karnataka, India", "4012345678"],
      ["Third Party Risk Analyst", "Northwind Bank", "Pune, Maharashtra, India", "4012345679"],
    ]);
  });
  it("Naukri: company, experience and city", () => {
    expect(parseAlertEmail(NAUKRI_HTML).map((d) => [d.title, d.company, d.location, d.experienceText])).toEqual([
      ["Information Security Analyst", "Contoso Technologies Pvt Ltd", "Mumbai", "3-6 Yrs"],
    ]);
  });
});

describe("relevance pre-filter", () => {
  const p = prefs({ excludedKeywords: ["sales"] });
  it.each(["Senior GRC Analyst", "Information Security Analyst II", "ISO 27001 Lead Auditor", "Third Party Risk Analyst", "IT Audit Manager", "Privacy & Data Protection Specialist"])("keeps %s", (t) => expect(isRelevantTitle(t, p)).toBe(true));
  it.each(["Account Executive", "Frontend Developer", "Security Sales Manager", "HR Business Partner"])("drops %s", (t) => expect(isRelevantTitle(t, p)).toBe(false));
});

describe("title-only jobs from alerts", () => {
  const job = { title: "Senior GRC Analyst", company: "Acme", location: "Bengaluru", description: "", portal: "linkedin", injectionFlag: false };
  it("matching title from an alert → TITLE_ONLY, goes to approval (not manual, not low relevance)", () => {
    const b = baselineScore({ ...job, source: "gmail_imap" }, FACTS, prefs(), []);
    expect(b.riskFlags).toContain("TITLE_ONLY");
    expect(b.riskFlags).not.toContain("MISSING_DESCRIPTION");
    const d = decide({ matchScore: b.overall, riskFlags: b.riskFlags, prefs: prefs(), connector: connectorPolicy("linkedin"), duplicate: false, previouslyRejected: false, counts: { today: 0, lastHour: 0, companyToday: 0 } });
    expect(d.decision).toBe("USER_APPROVAL");
  });
  it("non-matching title from an alert → low relevance", () => {
    const b = baselineScore({ ...job, title: "Sales Director", source: "gmail_imap" }, FACTS, prefs(), []);
    const d = decide({ matchScore: b.overall, riskFlags: b.riskFlags, prefs: prefs(), connector: connectorPolicy("linkedin"), duplicate: false, previouslyRejected: false, counts: { today: 0, lastHour: 0, companyToday: 0 } });
    expect(d.decision).toBe("LOW_RELEVANCE");
  });
  it("a pasted job with no description still asks for it", () => {
    expect(baselineScore({ ...job, source: "manual" }, FACTS, prefs(), []).riskFlags).toContain("MISSING_DESCRIPTION");
  });
});

describe("Adzuna source", () => {
  it("maps results and never exposes the key in errors", async () => {
    process.env.ADZUNA_APP_ID = "id1"; process.env.ADZUNA_APP_KEY = "secretkey";
    const { fetchAdzuna } = await import("@/lib/jobs/sources/adzuna");
    const body = { results: [{ id: 123, title: "GRC Analyst", description: "ISO 27001 audits and risk assessments for a fintech in Bengaluru, 3-5 years experience, hybrid.", redirect_url: "https://www.adzuna.in/land/ad/123", company: { display_name: "Acme" }, location: { display_name: "Bengaluru, Karnataka" }, salary_min: 1200000, salary_max: 1800000 }] };
    const calls: string[] = [];
    const f = vi.fn(async (u: string) => { calls.push(u); return new Response(JSON.stringify(body), { status: 200 }); });
    const d = await fetchAdzuna(["GRC Analyst"], "Bangalore", f as unknown as typeof fetch);
    expect(d[0]).toMatchObject({ portal: "adzuna", title: "GRC Analyst", company: "Acme", location: "Bengaluru, Karnataka", salaryText: "12-18 LPA", externalJobId: "adz-123", workMode: "hybrid" });
    expect(calls[0]).toContain("api.adzuna.com/v1/api/jobs/in/search/1");
    expect(calls[0]).toContain("where=Bangalore");
  });
});
