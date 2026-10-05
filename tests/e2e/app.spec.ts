import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import { totp } from "../../src/lib/auth/totp";
import { shot, USER, PDF, EVIL_PDF, STRONG_JD, INJECTION_JD, HALLUCINATE_JD, LINKEDIN_ALERT } from "./helpers";

test.describe.configure({ mode: "serial" });

let ctx: BrowserContext;
let page: Page;
let mfaSecret = "";
let strongJobUrl = "";
let applicationUrl = "";
const dialogs: string[] = [];

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ acceptDownloads: true });
  page = await ctx.newPage();
  page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });
});
test.afterAll(async () => { await ctx.close(); });

/** Sidebar navigation that waits for the destination page, avoiding client-navigation races. */
async function go(name: string) {
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&")}\\s*\\d*$`);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: re }).click();
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
}

async function freshCode() {
  // Avoid submitting a code in the last 2 s of its 30 s window.
  if (Date.now() % 30_000 > 28_000) await page.waitForTimeout(2500);
  return totp(mfaSecret);
}

test("1. unauthenticated users are sent to login; account registration enforces password policy", async () => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.waitForLoadState("networkidle");
  await shot(page, "login");
  await page.getByRole("link", { name: "Create your account" }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await page.getByLabel("Email").fill(USER.email);
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Confirm password").fill("short");
  await page.locator("form").evaluate((f) => f.querySelectorAll("input").forEach((i) => i.removeAttribute("minlength")));
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("at least 12 characters");
  await page.getByLabel("Password", { exact: true }).fill(USER.password);
  await page.getByLabel("Confirm password").fill(USER.password);
  await shot(page, "register");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/mfa$/);
});

test("2. MFA enrolment with an authenticator code; recovery codes shown once", async () => {
  await expect(page.getByAltText("Authenticator QR code")).toBeVisible();
  mfaSecret = (await page.getByTestId("mfa-secret").innerText()).trim();
  expect(mfaSecret).toMatch(/^[A-Z2-7]{32}$/);
  fs.writeFileSync(".e2e-mfa-secret", mfaSecret);
  await shot(page, "mfa-setup");
  await page.getByLabel(/6-digit code/).fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("did not match");
  await page.getByLabel(/6-digit code/).fill(await freshCode());
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByTestId("recovery-codes").locator("li")).toHaveCount(8);
  await shot(page, "mfa-recovery-codes");
  await page.getByRole("button", { name: /continue/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await shot(page, "dashboard-empty");
});

test("3. profile: sensitive fields saved encrypted", async () => {
  await go("My Profile");
  await page.getByLabel("Full name").fill("Priya Sharma");
  await page.getByLabel("Contact email").fill("priya@example.com");
  await page.getByLabel("Phone").fill("+91 98765 43210");
  await page.getByLabel("Current designation").fill("Information Security Analyst");
  await page.getByLabel("Current location").fill("Bengaluru");
  await page.getByLabel("Preferred locations").fill("Bengaluru, Pune");
  await page.getByLabel("Linkedin").fill("https://www.linkedin.com/in/example");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Full name")).toHaveValue("Priya Sharma");
  await page.getByLabel("Linkedin").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("https://");
  await page.getByLabel("Linkedin").fill("https://www.linkedin.com/in/example");
  await page.getByRole("button", { name: "Save profile" }).click();
  await shot(page, "profile");
});

test("4. verified facts: add, edit, private categories", async () => {
  await go("Verified Facts");
  let count = 0;
  const add = async (cat: string, label: string, value = "", num?: string, unit?: string) => {
    await page.getByLabel("Category").selectOption({ label: cat });
    await page.getByLabel("Label").fill(label);
    await page.getByLabel(/Details/).fill(value);
    if (num) { await page.getByLabel("Number").fill(num); await page.getByLabel("Unit").fill(unit ?? ""); }
    await page.getByRole("button", { name: "Add fact" }).click();
    count++;
    await expect(page.getByText(`${count} fact(s)`)).toBeVisible();
  };
  await add("Certification", "ISO/IEC 27001 Lead Auditor", "PECB, 2023");
  await add("Experience (years)", "Total experience", "", "3", "years");
  await add("Experience (years)", "GRC experience", "", "2", "years");
  await add("Skill", "Risk assessment and risk register");
  await add("Skill", "SOC 2 and ISO 27001 audits");
  await add("Skill", "Third-party risk management (vendor risk)");
  await add("Education", "B.Tech Computer Science", "VIT, 2021");
  await add("Job title", "Information Security Analyst");
  await add("Expected salary — private", "Expected CTC", "", "18", "LPA");
  await expect(page.getByTestId("fact-F009")).toContainText("expected salary");
  // edit
  await page.getByTestId("fact-F004").getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Label").fill("Risk assessment, risk register and control testing");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("fact-F004")).toContainText("v2");
  await shot(page, "verified-facts");
});

test("5. resumes: encrypted upload, active-content PDF rejected, approval", async () => {
  await go("Resumes");
  await page.getByLabel("Label").fill("Security GRC Resume");
  await page.getByLabel("Focus keywords").fill("GRC, ISO 27001, risk, audit");
  await page.locator('input[type="file"]').setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Uploaded and encrypted")).toBeVisible();
  await page.getByLabel("Label").fill("Malicious Resume");
  await page.locator('input[type="file"]').setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: EVIL_PDF });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("PDF contains JavaScript");
  await page.locator('input[type="file"]').setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ not really a pdf") });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Only PDF or DOCX");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Security GRC Resume approved")).toBeVisible();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  expect((await dl).suggestedFilename()).toBe("Security_GRC_Resume.pdf");
  await shot(page, "resumes");
});

test("6. preferences and limits", async () => {
  await go("Preferences & Limits");
  await page.getByLabel("Target job titles").fill("GRC Analyst, Information Security Analyst, Third Party Risk Analyst, Security Compliance Analyst, Risk & Compliance Analyst");
  await page.getByLabel("Keywords", { exact: true }).fill("ISO 27001, risk, audit, compliance");
  await page.getByLabel("Excluded keywords").fill("night shift, sales");
  await page.getByLabel("Preferred locations").fill("Bengaluru, Pune");
  await page.getByLabel("Minimum salary (LPA)").fill("12");
  await page.getByLabel("Minimum match score").fill("75");
  await page.getByLabel("Board token").fill("acme-example");
  await page.getByRole("button", { name: "Add board" }).click();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Preferences saved")).toBeVisible();
  await page.getByLabel("Password to enable auto apply").fill("wrong-password-123");
  await page.getByRole("button", { name: "Enable Auto Apply" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Password is incorrect");
  await shot(page, "preferences");
});

async function addJob(fields: { title: string; company: string; location: string; url: string; description: string; workMode?: string }) {
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Add job" }).click();
  const f = page.getByRole("form", { name: "Add job" });
  await f.getByLabel("Job title").fill(fields.title);
  await f.getByLabel("Company").fill(fields.company);
  await f.getByLabel("Location").fill(fields.location);
  await f.getByLabel("Job URL").fill(fields.url);
  if (fields.workMode) await f.getByLabel("Work mode").selectOption(fields.workMode);
  await f.getByLabel("Job description").fill(fields.description);
  await f.getByRole("button", { name: "Add and score" }).click();
}

test("7. add a job: AI + rules scoring, explanation, deterministic policy decision", async () => {
  await addJob({ title: "GRC Analyst", company: "Contoso Fintech", location: "Bengaluru", url: "https://www.linkedin.com/jobs/view/grc-analyst-at-contoso-4011112222/?trackingId=x", description: STRONG_JD, workMode: "hybrid" });
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  strongJobUrl = page.url();
  const score = Number(await page.getByTestId("match-score").innerText());
  expect(score).toBeGreaterThanOrEqual(75);
  await expect(page.getByText("Strong matches")).toBeVisible();
  await expect(page.getByText(/ISO 27001.*F00/).first()).toBeVisible();
  await expect(page.getByTestId("policy-rules")).toContainText("LinkedIn: terms require you to submit yourself");
  await expect(page.getByTestId("policy-rules")).toContainText("Approval Required mode");
  await expect(page.getByText("Your approval required", { exact: true })).toBeVisible();
  await shot(page, "job-strong-match");
});

test("8. duplicate job is refused (same LinkedIn job ID, different URL)", async () => {
  await addJob({ title: "GRC Analyst (repost)", company: "Contoso Fintech", location: "Bengaluru", url: "https://in.linkedin.com/jobs/view/4011112222", description: STRONG_JD });
  await expect(page.locator("main").getByRole("alert")).toContainText("already in your list");
  await shot(page, "duplicate-refused");
});

test("9. prompt-injection job is flagged, kept from the AI and sent to manual review", async () => {
  await addJob({ title: "Senior Security Compliance Analyst", company: "Evil Corp", location: "Remote", url: "https://www.naukri.com/job-listings-senior-security-compliance-analyst-evil-corp-remote-3-to-5-years-011025509999", description: INJECTION_JD, workMode: "remote" });
  await expect(page.getByText(/contains instructions aimed at an AI/)).toBeVisible();
  await expect(page.getByText("AI analysis skipped: job text contains prompt-injection patterns.")).toBeVisible();
  await expect(page.getByText("Manual action required").first()).toBeVisible();
  await expect(page.getByText("prompt injection detected")).toBeVisible();
  await shot(page, "job-prompt-injection");
});

test("10. hallucinating model output is corrected by guardrails", async () => {
  await addJob({ title: "Risk & Compliance Analyst", company: "Litware Bank", location: "Bengaluru", url: "https://www.linkedin.com/jobs/view/4011113333/", description: HALLUCINATE_JD, workMode: "hybrid" });
  await expect(page.getByText(/Guardrail: Dropped uncited strong match "CISSP certification"/)).toBeVisible();
  await expect(page.getByText(/Guardrail: Dropped unsupported certification claim "CISSP"/)).toBeVisible();
  await expect(page.getByText(/Guardrail: Moved "Python" from lacks to not-found/)).toBeVisible();
  await expect(page.getByText(/Ignored unknown flag/)).toBeVisible();
  await expect(page.getByTestId("policy-rules")).toContainText("AI suggested AUTO_APPLY; rules are stricter and win");
  const score = Number(await page.getByTestId("match-score").innerText());
  expect(score).toBeLessThan(100);
  await shot(page, "job-guardrails");
});

test("11. import LinkedIn alert email; descriptions missing → manual", async () => {
  await go("Jobs");
  await page.getByRole("button", { name: "Import alert email" }).click();
  await page.getByRole("form", { name: "Import alert email" }).locator("textarea").fill(LINKEDIN_ALERT);
  await page.getByRole("button", { name: "Extract jobs" }).click();
  await expect(page.getByText("Found 2 jobs in the alert email, added 2")).toBeVisible();
  await expect(page.getByRole("link", { name: "Lead GRC Consultant" })).toBeVisible();
  await shot(page, "alert-email-import");
});

test("12. Gmail sync through the MCP server (read-only tools)", async () => {
  await page.getByRole("button", { name: "Sync Gmail (MCP)" }).click();
  await expect(page.getByText(/Gmail: read 2 alert emails, found 3 jobs, added 3/)).toBeVisible();
  await page.getByRole("button", { name: "Sync Gmail (MCP)" }).click();
  await expect(page.getByText(/added 0, skipped 3 duplicates/)).toBeVisible();
  await shot(page, "gmail-mcp-sync");
});

test("13. career-board sync fails gracefully when the network is blocked", async () => {
  await page.getByRole("button", { name: "Sync career boards" }).click();
  await expect(page.getByText(/greenhouse:acme-example: error/)).toBeVisible();
  await page.getByLabel("Filter by status").selectOption("Manual Action Required");
  await expect(page.getByRole("link", { name: "Senior Security Compliance Analyst" })).toBeVisible();
  await shot(page, "jobs-filter-manual");
  await page.getByLabel("Filter by status").selectOption("");
  await shot(page, "jobs-list");
});

test("14. paste a description on an alert-email job and re-score", async () => {
  await page.getByRole("link", { name: "Security Compliance Analyst", exact: true }).first().click();
  await page.getByLabel("Job description").fill(STRONG_JD.replace("GRC Analyst", "Security Compliance Analyst"));
  await page.getByRole("button", { name: "Save & re-score" }).click();
  await expect(page.getByText("Re-scored.")).toBeVisible();
  await expect(page.getByTestId("policy-rules")).toContainText("Description present");
});

test("15. approve the strong job → application with Apply Pack", async () => {
  await page.goto(strongJobUrl);
  await expect(page.getByLabel("Resume to use")).toHaveValue(/.+/);
  await page.getByRole("button", { name: "Approve & prepare Apply Pack" }).click();
  await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}$/);
  applicationUrl = page.url();
  await expect(page.getByText("Apply Pack — submit this application yourself")).toBeVisible();
  await expect(page.getByText(/Submit on LinkedIn yourself — User Agreement §8.2 prohibits bots/)).toBeVisible();
  await shot(page, "apply-pack");
});

test("16. application questions: rules, AI drafts, sensitive routing and hallucination rejection", async () => {
  await page.getByLabel(/Paste the portal's questions/).fill([
    "Do you have 5+ years of experience?",
    "Are you ISO 27001 Lead Auditor certified?",
    "Do you hold a CISSP certification?",
    "What is your expected CTC?",
    "Describe your experience with vendor risk reviews. MOCK_HALLUCINATE",
    "Describe your experience with risk assessment.",
  ].join("\n"));
  await page.getByRole("button", { name: "Draft answers" }).click();
  await expect(page.getByText("Answers drafted")).toBeVisible();
  const qs = page.getByTestId("questions").locator("li");
  await expect(qs).toHaveCount(6);
  await expect(page.getByLabel("Answer to: Do you have 5+ years of experience?")).toHaveValue(/^No — I have 3 years/);
  await expect(page.getByLabel("Answer to: Are you ISO 27001 Lead Auditor certified?")).toHaveValue(/^Yes — ISO\/IEC 27001 Lead Auditor/);
  await expect(qs.nth(2)).toContainText("HUMAN REVIEW REQUIRED");
  await expect(qs.nth(2)).toContainText("does not mean you lack it");
  await expect(qs.nth(3)).toContainText("Sensitive question (salary)");
  await expect(page.getByLabel("Answer to: What is your expected CTC?")).toHaveValue("18 LPA");
  await expect(qs.nth(4)).toContainText("HUMAN REVIEW REQUIRED");
  await expect(qs.nth(4)).toContainText(/Guardrail: .*CISSP/);
  await expect(qs.nth(5)).toContainText("drafted");
  await shot(page, "questions-drafted");
});

test("17. cover letter from verified facts", async () => {
  await page.getByLabel("Tone").selectOption("professional");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByText("Cover letter generated from verified facts.")).toBeVisible();
  await expect(page.getByLabel("Cover letter")).toHaveValue(/ISO\/IEC 27001 Lead Auditor/);
  await page.getByLabel("Cover letter").fill((await page.getByLabel("Cover letter").inputValue()) + "\nI also hold CISSP.");
  await page.getByRole("button", { name: "Save edits" }).click();
  await expect(page.getByText(/Mentions CISSP, which is not in your verified facts/)).toBeVisible();
  await page.getByLabel("Cover letter").fill((await page.getByLabel("Cover letter").inputValue()).replace("\nI also hold CISSP.", ""));
  await page.getByRole("button", { name: "Save edits" }).click();
  await expect(page.getByText(/Mentions CISSP, which is not in your verified facts/)).toHaveCount(0);
  await shot(page, "cover-letter");
});

test("18. cannot mark applied with unapproved answers; approve, then submit and track", async () => {
  await page.getByRole("button", { name: "Mark as applied" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Approve or remove 6 answer(s)");
  await page.getByLabel("Answer to: Do you hold a CISSP certification?").fill("No, but I am preparing for it.");
  await page.getByLabel(/Answer to: Describe your experience with vendor risk/).fill("I run third-party risk reviews for our vendors.");
  for (let i = 0; i < 6; i++) {
    await page.getByTestId("questions").getByRole("button", { name: "Approve" }).first().click();
    await page.waitForTimeout(300);
  }
  await expect(page.getByText("All approved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark as applied" }).click();
  await expect(page.getByText("Marked as applied.")).toBeVisible();
  await page.getByRole("button", { name: "→ Interview" }).click();
  await expect(page.getByText("Moved to Interview.")).toBeVisible();
  await page.getByLabel("Follow-up date").fill("2026-10-08");
  await page.getByLabel("Current hiring status").fill("Technical round scheduled");
  await page.getByLabel("Notes (encrypted)").fill("Recruiter: ask about team size.");
  await page.getByRole("button", { name: "Save tracking" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByTestId("history")).toContainText("application status changed");
  await shot(page, "application-tracking");
});

test("19. Action Required queue", async () => {
  await go("Action Required");
  await expect(page.getByTestId("ar-job").first()).toBeVisible();
  await expect(page.getByText(/No prompt-injection content/)).toBeVisible();
  await shot(page, "action-required");
});

test("20. register and CSV/XLSX export", async () => {
  await go("Application Register");
  await expect(page.getByText("APP-000001")).toBeVisible();
  await expect(page.getByText("Technical round scheduled")).toBeVisible();
  for (const fmt of ["CSV", "XLSX"]) {
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: `Export ${fmt}` }).click();
    expect((await dl).suggestedFilename()).toMatch(new RegExp(`jobpilot-applications-.*\\.${fmt.toLowerCase()}$`));
  }
  await shot(page, "application-register");
});

test("21. Emergency Stop blocks approvals and discovery; Pause/Resume", async () => {
  await page.getByRole("button", { name: "Emergency Stop" }).click();
  await expect(page.getByTestId("automation-state")).toContainText("EMERGENCY STOP");
  await expect(page.getByText(/Emergency Stop is active/).first()).toBeVisible();
  await shot(page, "emergency-stop");
  await go("Jobs");
  await page.getByRole("button", { name: "Sync Gmail (MCP)" }).click();
  await expect(page.locator("main").getByRole("alert").filter({ hasText: "paused or stopped" })).toBeVisible();
  await page.getByRole("link", { name: "Lead GRC Consultant" }).click();
  await page.getByRole("button", { name: "Approve & prepare Apply Pack" }).click();
  await expect(page.locator("main").getByRole("alert").filter({ hasText: "Emergency Stop is active" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByTestId("automation-state")).toContainText("running");
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByTestId("automation-state")).toContainText("paused");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByTestId("automation-state")).toContainText("running");
});

test("22. dashboard statistics and notifications", async () => {
  await go("Dashboard");
  await expect(page.getByText("Total applications")).toBeVisible();
  await expect(page.getByText("APP-000001")).toBeVisible();
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByText(/High match|Ready to submit|Action required/).first()).toBeVisible();
  await shot(page, "dashboard");
  await page.getByRole("button", { name: "Notifications" }).click();
});

test("23. audit log is hash-chained and verifies", async () => {
  await go("Audit Log");
  await page.getByRole("button", { name: "Verify integrity" }).click();
  await expect(page.getByText(/Chain intact — \d+ entries verified/)).toBeVisible();
  await expect(page.getByText("emergency stop", { exact: true })).toBeVisible();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await dl).suggestedFilename()).toMatch(/jobpilot-audit-/);
  await shot(page, "audit-log");
});

test("24. security page: events, sessions, AI gateway log", async () => {
  await go("Security");
  await expect(page.getByText("prompt injection detected").first()).toBeVisible();
  await expect(page.getByText("upload rejected").first()).toBeVisible();
  await expect(page.getByText("reauth failed").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "evaluate" }).first()).toBeVisible();
  await shot(page, "security");
});

test("25. data & integrations: Ollama status, connector ToS register, export my data", async () => {
  await go("Data & Integrations");
  await expect(page.getByText("qwen2.5:3b ready")).toBeVisible();
  await expect(page.getByText("Configured")).toBeVisible();
  await expect(page.getByRole("row", { name: /LinkedIn/ })).toContainText("Not allowed");
  await page.getByLabel("Password for export").fill(USER.password);
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  expect((await dl).suggestedFilename()).toBe("jobpilot-my-data.json");
  await shot(page, "settings");
});

test("26. sign out and back in with password + TOTP", async () => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/applications");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill(USER.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Email or password is incorrect");
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/mfa$/);
  await page.getByLabel(/6-digit code or a recovery code/).fill(await freshCode());
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("27. delete application history (re-auth + typed confirmation)", async () => {
  await go("Data & Integrations");
  await page.getByLabel("Delete scope").selectOption("history");
  await page.getByLabel("Password for delete").fill(USER.password);
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
  await page.getByLabel("Confirm delete").fill("DELETE");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("All application history deleted.")).toBeVisible();
  await go("Application Register");
  await expect(page.getByText("No applications match.")).toBeVisible();
  expect(dialogs).toEqual([]); // no XSS/alert() fired anywhere
});
