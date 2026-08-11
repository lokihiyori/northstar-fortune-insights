import { describe, expect, it } from "vitest";
import {
  demoModeConfigured,
  demoAccountEmail,
  demoAccountPassword,
  isDemoEmail,
} from "@/features/demo/config";

/**
 * The disabled path, at every decision point that depends on it.
 *
 * The e2e suite proves the *enabled* behaviour against a running server. It
 * cannot prove the disabled behaviour in the same run, because the flag is read
 * at request time from the server's environment and the suite boots one server.
 * So the disabled case is pinned here, at the two functions the UI and the
 * Server Action actually branch on:
 *
 *   - `demoModeConfigured()` decides whether the sign-in page renders the
 *     entry point at all.
 *   - `demoModeEnabled()` is re-checked inside `demoSignInAction`, so a stale
 *     page cannot invoke it after the flag is turned off. `demoAccountEmail`
 *     and `demoAccountPassword` returning `null` is what makes that refusal
 *     unconditional — there is nothing left for the action to sign in with.
 */
const off = {
  DEMO_MODE_ENABLED: "false",
  DEMO_ACCOUNT_EMAIL: "demo@northstar.local",
  DEMO_ACCOUNT_PASSWORD: "a-long-enough-passphrase",
} as unknown as NodeJS.ProcessEnv;

const unset = {} as NodeJS.ProcessEnv;

describe("demo mode disabled", () => {
  it("renders no entry point", () => {
    expect(demoModeConfigured(off)).toBe(false);
    expect(demoModeConfigured(unset)).toBe(false);
  });

  it("leaves the action with no credentials to use", () => {
    // Even fully configured, the flag alone withholds both halves.
    expect(demoAccountEmail(off)).toBeNull();
    expect(demoAccountPassword(off)).toBeNull();
  });

  it("treats nobody as a demo user, so no banner and no denial applies", () => {
    expect(isDemoEmail("demo@northstar.local", off)).toBe(false);
    expect(isDemoEmail("demo@northstar.local", unset)).toBe(false);
  });

  it("cannot be switched on by a client-supplied value", () => {
    // Whatever a browser might send, demo status is read from the server's own
    // environment. These stand in for a forged body, query, or header.
    for (const forged of ["true", "1", "yes", "demo"]) {
      const env = { ...off, DEMO_MODE_CLIENT: forged } as unknown as NodeJS.ProcessEnv;
      expect(demoModeConfigured(env), forged).toBe(false);
      expect(isDemoEmail("demo@northstar.local", env), forged).toBe(false);
    }
  });
});
