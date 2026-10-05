import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  default: {
    lookup: vi.fn(async (host: string) => (host === "boards-api.greenhouse.io" ? [{ address: "104.18.1.1", family: 4 }] : host === "api.lever.co" ? [{ address: "10.0.0.5", family: 4 }] : [])),
  },
}));

import { parseAlertEmail } from "@/lib/jobs/sources/alertEmail";
import { assertFetchable, isPrivateIp, safeFetchJson } from "@/lib/jobs/ssrf";
import { fetchBoard } from "@/lib/jobs/sources/careerBoards";
import { extractMessageIds } from "@/lib/jobs/sources/mcpGmail";
import { inspectFile } from "@/lib/resumes";
import { canonical, computeRowHash } from "@/lib/audit";

const LINKEDIN = `Your job alert for GRC Analyst
3 new jobs match your preferences.

Senior GRC Analyst
Acme Fintech
Bengaluru, Karnataka, India
Actively recruiting
View job: https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc%3D&refId=xyz

Third Party Risk Analyst
Northwind Bank
Pune, Maharashtra, India
View job: https://www.linkedin.com/comm/jobs/view/4012345679/?trackingId=def

See all jobs: https://www.linkedin.com/comm/jobs/search?keywords=grc`;

const NAUKRI_HTML = `<table><tr><td><a href="https://www.naukri.com/job-listings-information-security-analyst-contoso-technologies-mumbai-3-to-6-years-011025500123?src=jobalert">Information Security Analyst</a></td></tr>
<tr><td>Contoso Technologies Pvt Ltd</td></tr><tr><td>3-6 Yrs | Mumbai</td></tr></table>`;

describe("alert email parser", () => {
  it("extracts LinkedIn jobs with title/company/location and dedupes links", () => {
    const d = parseAlertEmail(LINKEDIN);
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ portal: "linkedin", title: "Senior GRC Analyst", company: "Acme Fintech", location: "Bengaluru, Karnataka, India", externalJobId: "4012345678" });
    expect(d[1]).toMatchObject({ title: "Third Party Risk Analyst", company: "Northwind Bank" });
  });
  it("extracts Naukri jobs from HTML", () => {
    const d = parseAlertEmail(NAUKRI_HTML);
    expect(d).toHaveLength(1);
    expect(d[0].portal).toBe("naukri");
    expect(d[0].externalJobId).toBe("011025500123");
    expect(d[0].title).toMatch(/Information Security Analyst/i);
  });
  it("ignores non-job links and sanitises text", () => {
    expect(parseAlertEmail("hello https://evil.example/x <script>alert(1)</script>")).toEqual([]);
  });
});

describe("SSRF guard", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "100.64.0.1"])("private: %s", (ip) => expect(isPrivateIp(ip)).toBe(true));
  it("public IPs are allowed", () => expect(isPrivateIp("104.18.1.1")).toBe(false));
  it("blocks http, credentials, ports, IP literals and unknown hosts", async () => {
    await expect(assertFetchable("http://boards-api.greenhouse.io/v1")).rejects.toThrow(/https/);
    await expect(assertFetchable("https://user:pw@boards-api.greenhouse.io/")).rejects.toThrow(/Credentials/);
    await expect(assertFetchable("https://boards-api.greenhouse.io:8443/")).rejects.toThrow(/port/);
    await expect(assertFetchable("https://169.254.169.254/latest/meta-data")).rejects.toThrow(/allowlist/);
    await expect(assertFetchable("https://www.linkedin.com/jobs")).rejects.toThrow(/allowlist/);
  });
  it("blocks allowlisted hosts that resolve privately (DNS rebinding)", async () => {
    await expect(assertFetchable("https://api.lever.co/v0/postings/x")).rejects.toThrow(/private/);
  });
  it("does not follow redirects", async () => {
    const f = vi.fn(async () => new Response("", { status: 302, headers: { location: "http://169.254.169.254" } }));
    await expect(safeFetchJson("https://boards-api.greenhouse.io/v1/boards/x/jobs", f as unknown as typeof fetch)).rejects.toThrow(/Redirect/);
  });
});

describe("career boards", () => {
  it("maps Greenhouse jobs and sanitises HTML content", async () => {
    const body = { jobs: [{ id: 42, title: "GRC Analyst", absolute_url: "https://boards.greenhouse.io/acme/jobs/42", location: { name: "Remote - India" }, content: "&lt;p&gt;ISO 27001 &lt;script&gt;x&lt;/script&gt;fully remote&lt;/p&gt;" }] };
    const f = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const d = await fetchBoard({ vendor: "greenhouse", token: "acme" }, f as unknown as typeof fetch);
    expect(d[0]).toMatchObject({ portal: "greenhouse", title: "GRC Analyst", externalJobId: "gh-acme-42", workMode: "remote" });
    expect(d[0].description).not.toMatch(/script|</);
  });
  it("rejects bad board tokens", async () => {
    await expect(fetchBoard({ vendor: "greenhouse", token: "../../etc" })).rejects.toThrow(/token/);
  });
});

describe("MCP helpers", () => {
  it("extracts message IDs from text and JSON", () => {
    expect(extractMessageIds("ID: abc123456\nSubject: x\n\nID: def789012")).toEqual(["abc123456", "def789012"]);
    expect(extractMessageIds(JSON.stringify({ messages: [{ id: "x1y2z3a4" }] }))).toEqual(["x1y2z3a4"]);
  });
});

describe("resume file inspection", () => {
  it("accepts a plain PDF", () => expect(inspectFile(Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF"))).toEqual({ mime: "application/pdf", problems: [] }));
  it("rejects PDFs with JavaScript or launch actions", () => {
    expect(inspectFile(Buffer.from("%PDF-1.4 /OpenAction << /S /JavaScript /JS (app.alert(1)) >>")).problems.length).toBeGreaterThan(0);
    expect(inspectFile(Buffer.from("%PDF-1.4 /Launch /F (cmd.exe)")).problems.join()).toMatch(/auto-launch/);
  });
  it("rejects disguised and macro files", () => {
    expect(inspectFile(Buffer.from("MZ\x90\x00 this is an exe")).problems.join()).toMatch(/Only PDF or DOCX/);
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("[Content_Types].xml word/document.xml word/vbaProject.bin")]);
    expect(inspectFile(zip).problems.join()).toMatch(/macros/);
  });
  it("rejects oversize and empty files", () => {
    expect(inspectFile(Buffer.alloc(0)).problems.join()).toMatch(/empty/);
    expect(inspectFile(Buffer.alloc(6 * 1024 * 1024)).problems.join()).toMatch(/5 MB/);
  });
});

describe("audit hash chain", () => {
  it("canonical JSON is key-order independent", () => expect(canonical({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(canonical({ a: [2, { c: 4, d: 3 }], b: 1 })));
  it("any change alters the row hash", () => {
    const r = { seq: 1, ts: new Date("2026-10-01T10:31:00Z"), userId: "u", actor: "user" as const, action: "x", details: { a: 1 }, prevHash: "0".repeat(64) };
    const h = computeRowHash(r);
    expect(computeRowHash({ ...r, details: { a: 2 } })).not.toBe(h);
    expect(computeRowHash({ ...r, prevHash: "1".repeat(64) })).not.toBe(h);
    expect(computeRowHash({ ...r })).toBe(h);
  });
});

describe("audit hash stability across storage", () => {
  it("undefined detail values do not change the hash after a JSON round-trip", () => {
    const base = { seq: 2, ts: new Date("2026-10-01T10:32:00Z"), userId: "u", actor: "user" as const, action: "x", prevHash: "0".repeat(64) };
    const stored = JSON.parse(JSON.stringify({ from: "a", reason: undefined }));
    expect(computeRowHash({ ...base, details: stored })).toBe(computeRowHash({ ...base, details: { from: "a" } }));
  });
});
