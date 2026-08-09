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

    /**
     * Traces are collected locally but **not in CI**.
     *
     * A trace records every request and response, including `Set-Cookie` and
     * the resulting storage state — that is session material, and CI artifacts
     * are downloadable by anyone who can see the run. A developer reproducing
     * the same failure locally still gets the full trace, which is where that
     * level of detail is actually useful.
     *
     * Screenshots are kept: the e2e suite drives synthetic fixtures, so a
     * failure screenshot shows invented questions and `@northstar.test`
     * addresses, never anyone's real data.
     */
    trace: process.env["CI"] ? "off" : "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    /**
     * `next dev` in CI as well as locally, which is a deliberate reversal.
     *
     * This previously ran `pnpm start` in CI. That cannot work, and was proven
     * twice before it was changed:
     *
     *   - `next start` sets NODE_ENV=production, so Phase 8A startup validation
     *     demands an https, non-localhost `NEXT_PUBLIC_APP_URL`. Given the real
     *     CI URL the process exits before serving a request.
     *   - Given a fake https URL to satisfy that check, the server boots but
     *     authentication is dead over http: production forces `Secure` and the
     *     `__Secure-` prefix (ADR 0007), which a browser refuses to store on a
     *     plain-http origin, and Auth.js rejects the mismatched host. Sign-in
     *     silently yields no cookie and `/api/v1/me` answers 401.
     *
     * Serving the production build under test therefore needs real https —
     * a certificate and a terminating proxy, which is deployment work. Until
     * then `pnpm build` in the CI quality job is what proves the production
     * build compiles; this suite exercises behaviour, not the bundle.
     */
    command: `pnpm dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
