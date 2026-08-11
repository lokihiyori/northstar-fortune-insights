import { describe, expect, it } from "vitest";
import { checkResetConfiguration, maskEmail } from "@/features/demo/reset";
import { demoRateLimitKeys } from "@/features/demo/redis-cleanup";
import { RATE_LIMIT_KEY_PREFIX, rateLimitKey } from "@/lib/rate-limit/limiter";
import { digestIdentifier, normalizeIdentifier } from "@/lib/rate-limit/identity";

/**
 * The reset deletes rows, so its refusal matrix is the part worth testing
 * exhaustively. Every case here is a configuration that must *not* reach the
 * database.
 */
const valid = {
  DEMO_MODE_ENABLED: "true",
  DEMO_ACCOUNT_EMAIL: "demo@northstar.local",
  DEMO_ACCOUNT_PASSWORD: "a-long-enough-passphrase",
  NODE_ENV: "development",
} as unknown as NodeJS.ProcessEnv;

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...valid, ...overrides } as unknown as NodeJS.ProcessEnv;
}

describe("reset configuration guards", () => {
  it("accepts a complete, safe configuration", () => {
    const result = checkResetConfiguration(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.email).toBe("demo@northstar.local");
  });

  it("normalizes the target address before it is used to select a row", () => {
    const result = checkResetConfiguration(env({ DEMO_ACCOUNT_EMAIL: "  Demo@NorthStar.Local  " }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.email).toBe("demo@northstar.local");
  });

  it("refuses when demo mode is not enabled", () => {
    const result = checkResetConfiguration(env({ DEMO_MODE_ENABLED: "false" }));
    expect(result.ok).toBe(false);
  });

  it("refuses an empty or missing address", () => {
    for (const value of [undefined, "", "   "]) {
      expect(checkResetConfiguration(env({ DEMO_ACCOUNT_EMAIL: value })).ok, String(value)).toBe(
        false,
      );
    }
  });

  it("refuses wildcard-like and unexpanded values", () => {
    for (const value of [
      "*",
      "%",
      "%@northstar.local",
      "*@northstar.local",
      "${DEMO_ACCOUNT_EMAIL}",
      "%DEMO_ACCOUNT_EMAIL%",
      "demo@northstar.local demo2@northstar.local",
      "demo @northstar.local",
      "demo@",
      "northstar.local",
    ]) {
      expect(checkResetConfiguration(env({ DEMO_ACCOUNT_EMAIL: value })).ok, value).toBe(false);
    }
  });

  it("refuses the seeded development accounts", () => {
    for (const value of ["dev@northstar.local", "admin@northstar.local", "ADMIN@NorthStar.local"]) {
      expect(checkResetConfiguration(env({ DEMO_ACCOUNT_EMAIL: value })).ok, value).toBe(false);
    }
  });

  it("refuses a missing or short password", () => {
    for (const value of [undefined, "", "short"]) {
      expect(checkResetConfiguration(env({ DEMO_ACCOUNT_PASSWORD: value })).ok, String(value)).toBe(
        false,
      );
    }
  });

  it("refuses production without the explicit acknowledgement", () => {
    expect(checkResetConfiguration(env({ NODE_ENV: "production" })).ok).toBe(false);
    expect(
      checkResetConfiguration(env({ NODE_ENV: "production", DEMO_ALLOW_IN_PRODUCTION: "true" })).ok,
    ).toBe(true);
  });

  it("never puts the address in a refusal message", () => {
    const result = checkResetConfiguration(env({ DEMO_ACCOUNT_PASSWORD: "short" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain("demo@northstar.local");
  });
});

describe("identity masking", () => {
  it("keeps the domain but not the local part", () => {
    expect(maskEmail("demo@northstar.local")).toBe("d***o@northstar.local");
    expect(maskEmail("ab@example.com")).toBe("**@example.com");
    expect(maskEmail("a@example.com")).toBe("*@example.com");
  });
});

describe("demo redis key computation", () => {
  const args = { userId: "user_demo_123", email: "demo@northstar.local", secret: "test-secret" };

  it("matches the limiter's own key format", () => {
    // The cleanup module duplicates the prefix because the limiter is
    // `server-only` and cannot be imported by the operator CLI. This pins the
    // copy to the original so it cannot drift.
    const digest = digestIdentifier(normalizeIdentifier(args.email), args.secret);
    const keys = demoRateLimitKeys(args);

    expect(keys).toContain(rateLimitKey("auth_identifier", digest));
    expect(keys).toContain(rateLimitKey("guidance_user", args.userId));
    for (const key of keys) expect(key.startsWith(`${RATE_LIMIT_KEY_PREFIX}:`)).toBe(true);
  });

  it("never targets a per-IP bucket", () => {
    // An address is shared with everyone else behind it; clearing those would
    // hand a demo visitor somebody else's allowance.
    const keys = demoRateLimitKeys(args);
    for (const id of ["auth_ip", "sign_up_ip", "guidance_ip", "admin_mutation_ip"]) {
      expect(
        keys.some((key) => key.includes(`:${id}:`)),
        id,
      ).toBe(false);
    }
  });

  it("never targets retrieval cache or generation state", () => {
    for (const key of demoRateLimitKeys(args)) {
      expect(key.startsWith("northstar:retrieval")).toBe(false);
    }
  });

  it("omits user-subject keys when there is no existing demo user", () => {
    const keys = demoRateLimitKeys({ ...args, userId: null });
    expect(keys.some((key) => key.includes(":guidance_user:"))).toBe(false);
    expect(keys.some((key) => key.includes(":auth_identifier:"))).toBe(true);
  });

  it("computes a different digest for a different address", () => {
    const mine = demoRateLimitKeys(args);
    const theirs = demoRateLimitKeys({ ...args, email: "someone@example.com" });
    expect(mine.filter((k) => k.includes(":auth_identifier:"))).not.toEqual(
      theirs.filter((k) => k.includes(":auth_identifier:")),
    );
  });
});
