import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { DEMO_DISABLED_ORIGIN, DEMO_DISABLED_PORT } from "./tests/e2e/helpers/ports";
import { DEMO_DISABLED_RUN_SECRET_ENV } from "./tests/e2e-demo-disabled/helpers/run-identity";

/**
 * The disabled server's `AUTH_SECRET`, minted once per run.
 *
 * Hoisted to module scope because the teardown needs it too: the rate-limit
 * bucket the suite leaves behind is named by an HMAC under this value, so
 * without it the exact key cannot be computed. Published below on a dedicated
 * variable in *this* process only — never on `AUTH_SECRET`, which would shadow
 * the developer's persistent value — and stripped back out of the server's own
 * environment. It is never written to disk, logged, or committed.
 */
const runAuthSecret = randomBytes(32).toString("hex");
process.env[DEMO_DISABLED_RUN_SECRET_ENV] = runAuthSecret;

/*
 * The *test process* needs to know the demo credentials; the *server* must not.
 * That asymmetry is the whole point — the spec searches the served page for
 * these values, which only proves something if it has values to search for.
 * CI carries no `.env`, so they are defaulted here exactly as the main config
 * does, and `disabledServerEnv()` below deletes them again for the child.
 */
process.env["DEMO_ACCOUNT_EMAIL"] ??= "demo-e2e@northstar.test";
process.env["DEMO_ACCOUNT_PASSWORD"] ??= "demo-disabled-probe-value-not-a-real-secret";

/**
 * A second Playwright configuration, for one thing only: proving that demo mode
 * is unusable when the server is started with it switched off.
 *
 * Why a separate config and a separate run, rather than another server in the
 * main one:
 *
 *   - Demo mode is read from the server's environment on every request, so the
 *     disabled behaviour can only be proved by a process started with the flag
 *     off. A test that flipped a client-side value would prove nothing, because
 *     the browser is not the authority.
 *   - **Next 16 refuses to run two `next dev` servers from one project
 *     directory.** The lock lives under the dist directory and exits the
 *     process outright (`next/dist/build/lockfile.js`), so a second entry in
 *     the main config's `webServer` array cannot work — it takes the whole
 *     suite down.
 *   - Spawning the server inside a `beforeAll` is bounded by the test timeout,
 *     which booting `next dev` does not reliably fit inside. Raising that
 *     timeout to make room would have been the wrong fix.
 *
 * So this runs on its own, when the main server is not running. The spec lives
 * in `tests/e2e-demo-disabled/` rather than `tests/e2e/`, so the main config's
 * `testDir` excludes it automatically and **the main configuration is not
 * modified at all**.
 */
/**
 * Environment for the disabled server.
 *
 * Provider keys are **deleted**, not blanked. Phase 8A validates them as
 * all-or-nothing groups with `min(1)`, so an empty string is "present but
 * invalid" and the process refuses to start — which is the env guard working
 * correctly, and exactly why this is built by deletion.
 */
function disabledServerEnv(): Record<string, string> {
  const env: Record<string, string | undefined> = { ...process.env };

  for (const key of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PLUS_PRICE_ID",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "OPENAI_EMBEDDING_MODEL",
    "AUTH_GOOGLE_ID",
    "AUTH_GOOGLE_SECRET",
    "NEXT_PUBLIC_POSTHOG_KEY",
    "NEXT_PUBLIC_POSTHOG_HOST",
    // Not merely disabled: this process holds no demo credentials at all, so
    // it could not sign anyone into the demo even if something asked it to.
    "DEMO_ACCOUNT_EMAIL",
    "DEMO_ACCOUNT_PASSWORD",
    "DEMO_ALLOW_IN_PRODUCTION",
    // The teardown's copy of the run secret. The server already receives it as
    // `AUTH_SECRET` below and has no use for a second name.
    DEMO_DISABLED_RUN_SECRET_ENV,
  ]) {
    delete env[key];
  }

  // The subject of the test.
  env["DEMO_MODE_ENABLED"] = "false";
  // Per-run, never committed. Shared with the teardown so it can compute the
  // exact rate-limit key this run owns.
  env["AUTH_SECRET"] = runAuthSecret;
  env["NEXT_PUBLIC_APP_URL"] = DEMO_DISABLED_ORIGIN;

  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export default defineConfig({
  testDir: "./tests/e2e-demo-disabled",
  /*
   * Removes only the one rate-limit bucket this suite's failed sign-in creates.
   * Deliberately not the main suite's teardown, which also deletes database rows
   * and sweeps the whole rate-limit prefix — far broader than this suite owns.
   */
  globalTeardown: "./tests/e2e-demo-disabled/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  // Deliberately zero: this proof must not be rescued by a retry.
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: DEMO_DISABLED_ORIGIN,
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Loopback only, on a port nothing else in this repository binds.
    command: `pnpm exec next dev --port ${String(DEMO_DISABLED_PORT)} --hostname 127.0.0.1`,
    // Real readiness: the process answers its own liveness endpoint.
    url: `${DEMO_DISABLED_ORIGIN}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Discarded rather than piped: an undrained pipe eventually raises EPIPE
    // and takes the run down with it. Nothing needs this output, and no
    // temporary log file is left behind to clean up.
    stdout: "ignore",
    stderr: "ignore",
    env: disabledServerEnv(),
  },
});
