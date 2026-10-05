import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { totp } from "../../src/lib/auth/totp";
import { USER, shot } from "./helpers";

test("automatic discovery: Find jobs now pulls, scores and queues alert jobs", async ({ page }) => {
  test.setTimeout(240_000);
  await page.waitForTimeout(62_000); // fresh TOTP step + clear login rate-limit window from earlier suites
  await page.goto("/login");
  await page.getByLabel("Email").fill(USER.email);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/6-digit code/).fill(totp(fs.readFileSync(".e2e-mfa-secret", "utf8").trim()));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Automatic job discovery")).toBeVisible();
  await page.getByRole("button", { name: "Find jobs now" }).click();
  await expect(page.getByText(/Last run added \d+ new job/)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/Gmail alerts via MCP: \d+ found · \d+ relevant · \d+ new/)).toBeVisible();
  await shot(page, "discovery-dashboard");
  await page.goto("/jobs?status=Awaiting%20Approval");
  await expect(page.getByRole("link", { name: "Senior GRC Analyst" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Information Security Analyst" })).toBeVisible();
  await page.getByRole("link", { name: "Senior GRC Analyst" }).click();
  await expect(page.getByText("title only")).toBeVisible();
  await expect(page.getByTestId("policy-rules")).toContainText("Title matches your target roles");
  await shot(page, "discovery-title-only-job");
});
