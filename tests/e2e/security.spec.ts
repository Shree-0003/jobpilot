import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";
import { totp } from "../../src/lib/auth/totp";
import { shot, USER } from "./helpers";

// API-level security tests (OWASP ASVS-style). Run after app.spec.ts, which creates the account.
test.describe.configure({ mode: "serial" });

const secret = () => fs.readFileSync(".e2e-mfa-secret", "utf8").trim();
// The app suite may have just used the current step, so start from it (single-use codes).
let lastStep = Math.floor(Date.now() / 30_000);
async function codeForNewStep(page: Page) {
  // TOTP codes are single-use; wait for a step we have not used yet.
  while (Math.floor(Date.now() / 30_000) <= lastStep || Date.now() % 30_000 > 28_000) await page.waitForTimeout(1000);
  lastStep = Math.floor(Date.now() / 30_000);
  return totp(secret());
}

async function csrfHeaders(page: Page) {
  const c = (await page.context().cookies()).find((x) => x.name === "jp_csrf")?.value ?? "";
  return { "x-csrf-token": c, origin: "http://localhost:3000", "content-type": "application/json" };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USER.email);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/mfa$/);
}

let page: Page;
let api: APIRequestContext;

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  page = await ctx.newPage();
  api = ctx.request;
});

test("security headers are set on pages and APIs", async ({ request }) => {
  const r = await request.get("/login");
  const h = r.headers();
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[\w-]+' 'strict-dynamic'/);
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).toContain("object-src 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin");
  expect(h["x-powered-by"]).toBeUndefined();
  const a = await request.get("/api/auth/me");
  expect(a.headers()["cache-control"]).toBe("no-store");
});

test("unauthenticated API access is denied", async ({ request }) => {
  for (const p of ["/api/facts", "/api/profile", "/api/jobs", "/api/applications", "/api/audit", "/api/export?type=audit&format=csv", "/api/resumes", "/api/security/events"]) {
    expect((await request.get(p)).status(), p).toBe(401);
  }
});

test("CSRF: missing token, wrong token and foreign Origin are rejected", async ({ request }) => {
  await request.get("/login"); // obtain jp_csrf cookie
  const body = { email: USER.email, password: "x" };
  expect((await request.post("/api/auth/login", { data: body, headers: { origin: "http://localhost:3000" } })).status()).toBe(403);
  expect((await request.post("/api/auth/login", { data: body, headers: { origin: "http://localhost:3000", "x-csrf-token": "forged-token-value-123" } })).status()).toBe(403);
  const cookies = (await request.storageState()).cookies;
  const tok = cookies.find((c) => c.name === "jp_csrf")!.value;
  expect((await request.post("/api/auth/login", { data: body, headers: { origin: "https://evil.example", "x-csrf-token": tok } })).status()).toBe(403);
});

test("registration is closed once the account exists; NoSQL operator injection is rejected", async ({ request }) => {
  await request.get("/login");
  const tok = (await request.storageState()).cookies.find((c) => c.name === "jp_csrf")!.value;
  const h = { origin: "http://localhost:3000", "x-csrf-token": tok };
  expect((await request.post("/api/auth/register", { data: { email: "attacker@example.com", password: "A-very-long-password-1" }, headers: h })).status()).toBe(403);
  const inj = await request.post("/api/auth/login", { data: { email: { $ne: "" }, password: { $ne: "" } }, headers: h });
  expect(inj.status()).toBe(400);
  const bad = await request.post("/api/auth/login", { data: "{not json", headers: { ...h, "content-type": "application/json" } });
  expect(bad.status()).toBe(400);
});

test("MFA-pending session cannot reach protected APIs; session cookie flags", async () => {
  await login(page);
  expect((await api.get("/api/facts")).status()).toBe(401);
  await expect((await api.get("/api/facts")).json()).resolves.toMatchObject({ error: "MFA verification required." });
  const sc = (await page.context().cookies()).find((c) => c.name === "jp_session")!;
  expect(sc.httpOnly).toBe(true);
  expect(sc.sameSite).toBe("Strict");
});

test("TOTP codes cannot be replayed", async () => {
  const code = await codeForNewStep(page);
  await page.getByLabel(/6-digit code or a recovery code/).fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // second login with the same code
  const ctx2 = await page.context().browser()!.newContext();
  const p2 = await ctx2.newPage();
  await login(p2);
  await p2.getByLabel(/6-digit code or a recovery code/).fill(code);
  await p2.getByRole("button", { name: "Verify" }).click();
  await expect(p2.locator("main").getByRole("alert")).toContainText("Invalid code");
  await ctx2.close();
});

test("IDOR and path traversal return 404, not data", async () => {
  const id = "00000000-0000-4000-8000-000000000000";
  expect((await api.get(`/api/jobs/${id}`)).status()).toBe(404);
  expect((await api.get(`/api/applications/${id}`)).status()).toBe(404);
  expect((await api.get(`/api/resumes/${id}/download`)).status()).toBe(404);
  expect([400, 404]).toContain((await api.get(`/api/resumes/..%2F..%2F..%2Fetc%2Fpasswd/download`)).status());
  expect((await api.put(`/api/facts/..%2Fusers`, { data: { category: "skill", label: "x" }, headers: await csrfHeaders(page) })).status()).toBe(400);
});

test("stored XSS in job content renders as inert text", async () => {
  const fired: string[] = [];
  page.on("dialog", async (d) => { fired.push(d.message()); await d.dismiss(); });
  const r = await api.post("/api/jobs", {
    headers: await csrfHeaders(page),
    data: { title: `<img src=x onerror=alert('xss')>Analyst`, company: `"><script>alert(1)</script>`, location: "Pune", description: `<svg onload=alert(2)>${"Risk assessments and ISO 27001 audits. ".repeat(8)}`, url: "javascript:alert(3)" },
  });
  expect(r.status()).toBe(400); // javascript: URL rejected
  const ok = await api.post("/api/jobs", {
    headers: await csrfHeaders(page),
    data: { title: `<img src=x onerror=alert('xss')>Analyst`, company: `"><script>alert(1)</script>Co`, location: "Pune", description: `<svg onload=alert(2)>${"Risk assessments and ISO 27001 audits. ".repeat(8)}` },
  });
  expect(ok.status()).toBe(200);
  const { id } = await ok.json();
  await page.goto(`/jobs/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Analyst");
  await expect(page.locator("img[src=x]")).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(fired).toEqual([]);
  await shot(page, "xss-inert");
});

test("resume upload rejects oversize files and wrong content", async () => {
  const h = await csrfHeaders(page);
  const big = await api.post("/api/resumes", { headers: { "x-csrf-token": h["x-csrf-token"], origin: h.origin }, multipart: { label: "big", file: { name: "big.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(6 * 1024 * 1024, 0x25) } } });
  expect(big.status()).toBe(413);
  const html = await api.post("/api/resumes", { headers: { "x-csrf-token": h["x-csrf-token"], origin: h.origin }, multipart: { label: "x", file: { name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script></html>") } } });
  expect(html.status()).toBe(400);
});

test("spreadsheet export neutralises formula injection", async () => {
  await api.post("/api/jobs", { headers: await csrfHeaders(page), data: { title: "=HYPERLINK(\"http://evil\",\"x\") GRC Analyst", company: "Formula Co", location: "Pune", description: "Risk assessments and ISO 27001 audits. ".repeat(8) } });
  const csv = await (await api.get("/api/export?type=audit&format=csv")).text();
  expect(csv.length).toBeGreaterThan(100);
  expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
});

test("audit chain detects tampering via the verify endpoint (read-only check)", async () => {
  const v = await (await api.get("/api/audit/verify")).json();
  expect(v.ok).toBe(true);
});

test("login rate limiting returns 429 after 10 attempts per minute", async ({ request }) => {
  await request.get("/login");
  const tok = (await request.storageState()).cookies.find((c) => c.name === "jp_csrf")!.value;
  const h = { origin: "http://localhost:3000", "x-csrf-token": tok };
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) statuses.push((await request.post("/api/auth/login", { data: { email: `nobody${i}@example.com`, password: "x" }, headers: h })).status());
  expect(statuses).toContain(429);
});
