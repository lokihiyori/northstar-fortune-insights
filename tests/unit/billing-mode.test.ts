import { describe, expect, it } from "vitest";

import {
  expectedLivemode,
  livemodeMatches,
  resolveStripeMode,
  stripeModeFromKey,
  StripeModeError,
} from "@/features/billing/mode";

/**
 * Stripe mode comes from the configured key, never from NODE_ENV.
 *
 * The regression this locks: an earlier design derived expected `livemode` from
 * `NODE_ENV === "production"`, which would have rejected every object in the
 * exact configuration used for local verification — production runtime against
 * test-mode keys.
 */

// Fake keys. Structure only; no real credential appears in this repository.
const TEST_SECRET = "sk_test_0000000000000000000000000000";
const TEST_RESTRICTED = "rk_test_0000000000000000000000000000";
const LIVE_SECRET = "sk_live_0000000000000000000000000000";
const LIVE_RESTRICTED = "rk_live_0000000000000000000000000000";

describe("mode derivation from the key", () => {
  it.each([
    [TEST_SECRET, "test"],
    [TEST_RESTRICTED, "test"],
    [LIVE_SECRET, "live"],
    [LIVE_RESTRICTED, "live"],
  ])("classifies a %s-shaped key", (key, mode) => {
    expect(stripeModeFromKey(key)).toBe(mode);
  });

  it.each([[undefined], [""], ["pk_test_abc"], ["whsec_abc"], ["sk_"], ["nonsense"]])(
    "refuses to guess for %s",
    (key) => {
      expect(() => stripeModeFromKey(key as string | undefined)).toThrow(StripeModeError);
    },
  );

  it("names the variable and the rule, never the value", () => {
    let message = "";
    try {
      stripeModeFromKey("sk_bogus_SUPERSECRETVALUE");
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("STRIPE_SECRET_KEY");
    expect(message).not.toContain("SUPERSECRETVALUE");
    expect(message).not.toContain("sk_bogus_");
  });
});

describe("NODE_ENV does not decide Stripe mode", () => {
  it("accepts a test key under NODE_ENV=production and expects livemode false", () => {
    const env = {
      NODE_ENV: "production",
      STRIPE_SECRET_KEY: TEST_SECRET,
    } as unknown as NodeJS.ProcessEnv;

    expect(resolveStripeMode(env)).toBe("test");
    expect(expectedLivemode(env)).toBe(false);
    expect(livemodeMatches(false, env)).toBe(true);
    expect(livemodeMatches(true, env)).toBe(false);
  });

  it("accepts a live key under NODE_ENV=development and expects livemode true", () => {
    const env = {
      NODE_ENV: "development",
      STRIPE_SECRET_KEY: LIVE_SECRET,
    } as unknown as NodeJS.ProcessEnv;

    expect(resolveStripeMode(env)).toBe("live");
    expect(expectedLivemode(env)).toBe(true);
    expect(livemodeMatches(true, env)).toBe(true);
    expect(livemodeMatches(false, env)).toBe(false);
  });
});

describe("STRIPE_MODE cross-check", () => {
  it("agrees with the key", () => {
    const env = {
      STRIPE_SECRET_KEY: TEST_SECRET,
      STRIPE_MODE: "test",
    } as unknown as NodeJS.ProcessEnv;
    expect(resolveStripeMode(env)).toBe("test");
  });

  it("refuses when it disagrees, naming both variables and neither value", () => {
    const env = {
      STRIPE_SECRET_KEY: TEST_SECRET,
      STRIPE_MODE: "live",
    } as unknown as NodeJS.ProcessEnv;

    let message = "";
    try {
      resolveStripeMode(env);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("STRIPE_MODE");
    expect(message).toContain("STRIPE_SECRET_KEY");
    expect(message).not.toContain(TEST_SECRET);
  });

  it("is optional", () => {
    const env = { STRIPE_SECRET_KEY: LIVE_SECRET } as unknown as NodeJS.ProcessEnv;
    expect(resolveStripeMode(env)).toBe("live");
  });
});

describe("mixing test and live objects is impossible in both directions", () => {
  it("a test-mode process rejects a live object", () => {
    const env = { STRIPE_SECRET_KEY: TEST_SECRET } as unknown as NodeJS.ProcessEnv;
    expect(livemodeMatches(true, env)).toBe(false);
  });

  it("a live-mode process rejects a test object", () => {
    const env = { STRIPE_SECRET_KEY: LIVE_SECRET } as unknown as NodeJS.ProcessEnv;
    expect(livemodeMatches(false, env)).toBe(false);
  });
});
