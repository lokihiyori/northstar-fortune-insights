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
  // Serial, locally as well as in CI.
  //
  // This suite runs against `next dev`, which compiles routes on demand, so two
  // workers contend for one server. That was tolerable at 42 tests; at 53 —
  // several of which drive a dozen sequential sign-in navigations — it showed
  // up as a 30-second test budget exhausted in whichever journey happened to be
  // unlucky, a different one each run. That is the signature of starvation, not
  // a defect in the test that reported it.
  //
  // Removing the second worker removes the contention. **No test timeout is
  // raised anywhere**; the budget is unchanged and now fits.
  //
  // The durable fix is still 8D's: run e2e against a production build locally,
  // as CI does, which removes on-demand compilation altogether. It cannot be
  // done here because `next start` demands a production-valid environment
  // (https app URL, real AUTH_SECRET) that a developer's `.env` deliberately
  // does not have — see ADR 0007.
  workers: 1,
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
