import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env["PLAYWRIGHT_PORT"] ?? 3000);
// `localhost` rather than `127.0.0.1`: the Next dev server treats them as
// different origins and blocks its own dev resources across the mismatch.
const baseURL = process.env["PLAYWRIGHT_BASE_URL"] ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Auth and onboarding specs create real rows; this removes them afterwards.
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: true,
  // A committed `test.only` should fail CI rather than silently skip the suite.
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  // Capped rather than left to Playwright's default (roughly half the cores).
  //
  // Locally this suite usually runs against `next dev`, which compiles routes
  // on demand, so heavy journeys and light header checks contend for the same
  // single server. Above two workers that contention showed up as navigation
  // timeouts in whichever journey happened to be unlucky — a different test
  // each run, which is the signature of starvation rather than a defect.
  //
  // This addresses the contention directly. No test timeout is raised anywhere.
  // The durable fix belongs to 8D: run e2e against a production build locally
  // as CI already does, which removes on-demand compilation entirely.
  workers: process.env["CI"] ? 1 : 2,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: process.env["CI"] ? `pnpm start --port ${PORT}` : `pnpm dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
