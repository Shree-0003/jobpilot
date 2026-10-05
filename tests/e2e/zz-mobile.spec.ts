import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { totp } from "../../src/lib/auth/totp";
import { USER, shot } from "./helpers";

test.use({ viewport: { width: 390, height: 844 } });
test("mobile: menu gives access to every page", async ({ page }) => {
  while (Date.now() % 30_000 < 2000 || Date.now() % 30_000 > 27_000) await page.waitForTimeout(500);
  test.setTimeout(180_000);
  await page.waitForTimeout(62_000); // fresh TOTP step and clear the login rate-limit window left by the security suite
  await page.goto("/login");
  await page.getByLabel("Email").fill(USER.email);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/6-digit code/).fill(totp(fs.readFileSync(".e2e-mfa-secret", "utf8").trim()));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await shot(page, "mobile-dashboard");
  await page.getByRole("button", { name: "Menu" }).click();
  await shot(page, "mobile-menu");
  await page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "Verified Facts" }).click();
  await expect(page.getByRole("heading", { name: "Verified Facts" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
