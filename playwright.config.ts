import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env["PLAYWRIGHT_PORT"] ?? 3000);
// `localhost` rather than `127.0.0.1`: the Next dev server treats them as
// different origins and blocks its own dev resources across the mismatch.
const baseURL = process.env["PLAYWRIGHT_BASE_URL"] ?? `http://localhost:${PORT}`;

/*
 * Demo mode configuration for the suite, so the demo specs are hermetic.
 *
 * Demo status is a *server* setting read from the environment, and the server
 * here is a child of this process — so the values have to exist here, before
 * anything is spawned. CI carries no `.env`, which is why these values are
 * defined at all: without them the demo specs would have to be skipped, and a
 * skipped test proves nothing.
 *
 * **Assigned, not defaulted.** These were `??=`, which let a developer's `.env`
 * win. That looked accommodating and was the opposite: this file does not load
 * dotenv, so the value here was the built-in one while a separately started
 * `pnpm dev` — which does load `.env` — served the persistent seeded
 * `demo@northstar.local`. Reusing that server ran the demo specs against one
 * identity while `demo:reset` reset another, and the seeded account silently
 * accumulated reports against its monthly allowance until the Generate button
 * disabled itself. Measured: the seeded account's usage rose while its row id
 * never changed, so nothing had reset it.
 *
 * The address stays on the `@northstar.test` domain the suite already reserves,
 * so the existing teardown removes the account when the run ends, and the
 * password is random per run and never committed. The suite therefore owns the
 * demo identity outright and cannot touch `demo@northstar.local`.
 *
 * `tests/e2e-demo-disabled` deliberately strips all of this back out again.
 */
/*
 * The flag and the address are constants, so assigning them unconditionally is
 * safe and is what makes the identity test-owned.
 *
 * The password cannot be assigned the same way. Playwright evaluates this file
 * once in the runner and again in every worker, so an unconditional
 * `randomBytes` mints a different secret in each process: the worker would then
 * create the demo account through `demo:reset` with one password while the
 * server it signs into holds another, and every demo sign-in hangs. Generated
 * once and inherited by the children instead.
 */
process.env["DEMO_MODE_ENABLED"] = "true";
process.env["DEMO_ACCOUNT_EMAIL"] = "demo-e2e@northstar.test";
process.env["DEMO_ACCOUNT_PASSWORD"] ??= randomBytes(24).toString("hex");

const DEMO_ENV = {
  DEMO_MODE_ENABLED: process.env["DEMO_MODE_ENABLED"],
  DEMO_ACCOUNT_EMAIL: process.env["DEMO_ACCOUNT_EMAIL"],
  DEMO_ACCOUNT_PASSWORD: process.env["DEMO_ACCOUNT_PASSWORD"],
} as const;

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
    /*
     * Never reuse, locally either.
     *
     * Reuse cannot verify what the running server was configured with. A
     * developer's `pnpm dev` loads `.env` and serves the persistent seeded demo
     * account; this process serves a test-owned one. Reusing it ran the specs
     * against a different identity than the one `demo:reset` prepared, and did
     * so silently — the suite passed while quietly consuming the seeded
     * account's monthly allowance.
     *
     * Owning the server makes the demo identity, and every other variable
     * below, a fact rather than an assumption. The cost is that port 3000 must
     * be free: with a dev server already up, the run now fails to bind and says
     * so, which is the honest outcome. The port is unchanged so the CI
     * workflow's NEXT_PUBLIC_APP_URL still matches.
     */
    reuseExistingServer: false,
    timeout: 120_000,
    /*
     * Passed explicitly rather than relying on inheritance, so the server's
     * demo identity is visibly the same one the specs and `demo:reset` use.
     * Next does not override an environment variable that is already set, so
     * these win over `.env` in the child.
     */
    env: { ...DEMO_ENV },
  },
});
