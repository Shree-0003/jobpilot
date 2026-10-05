import { defineConfig } from "@playwright/test";
import fs from "node:fs";

const chromium = process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    viewport: { width: 1360, height: 900 },
    launchOptions: fs.existsSync(chromium) ? { executablePath: chromium } : {},
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
