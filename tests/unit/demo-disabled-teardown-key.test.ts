import { afterEach, describe, expect, it, vi } from "vitest";

import { RATE_LIMIT_KEY_PREFIX, rateLimitKey } from "@/lib/rate-limit/limiter";
import { RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";
import { digestIdentifier, normalizeIdentifier } from "@/lib/rate-limit/identity";
import {
  DEMO_DISABLED_PROBE_EMAIL,
  DEMO_DISABLED_RUN_SECRET_ENV,
  demoDisabledAuthIdentifierKey,
} from "../e2e-demo-disabled/helpers/run-identity";

/**
 * The demo-disabled teardown deletes one key by name, so the name has to be the
 * one the limiter actually writes. These tests use the production composer as
 * the oracle: if the prefix, the policy id, or the digest ever changes, the
 * teardown would silently delete nothing and the leak would come back quietly.
 *
 * `limiter.ts` is `server-only`, which is why the teardown itself cannot import
 * it — Vitest stubs the marker, so a unit test can, and that is exactly what
 * makes it a usable oracle here.
 */

// Not a real secret: any value works, because the assertion is that both sides
// derive the same key from the same input.
const RUN_SECRET = "demo-disabled-unit-test-run-secret";

/**
 * Records whether a Redis client was ever constructed.
 *
 * The teardown must refuse a missing run secret *before* it touches Redis, so
 * "no client was built" is the proof that nothing could have been read or
 * deleted. Every method throws, so a connection attempt would fail loudly
 * rather than reach a real server.
 */
const redisConstructed = vi.fn();
vi.mock("ioredis", () => ({
  default: class {
    constructor(...args: unknown[]) {
      redisConstructed(args.length);
    }
    connect(): never {
      throw new Error("teardown must not connect when the run secret is missing");
    }
    exists(): never {
      throw new Error("teardown must not read when the run secret is missing");
    }
    del(): never {
      throw new Error("teardown must not delete when the run secret is missing");
    }
    disconnect(): void {}
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("demo-disabled teardown key", () => {
  it("matches the key the production limiter would write", () => {
    const expected = rateLimitKey(
      RATE_LIMIT_POLICIES.AUTH_IDENTIFIER.id,
      digestIdentifier(normalizeIdentifier(DEMO_DISABLED_PROBE_EMAIL), RUN_SECRET),
    );

    expect(demoDisabledAuthIdentifierKey(RUN_SECRET)).toBe(expected);
  });

  it("targets exactly one key, under the rate-limit prefix and the AUTH_IDENTIFIER policy", () => {
    const key = demoDisabledAuthIdentifierKey(RUN_SECRET);

    expect(key.startsWith(`${RATE_LIMIT_KEY_PREFIX}:`)).toBe(true);
    expect(key).toContain(`:${RATE_LIMIT_POLICIES.AUTH_IDENTIFIER.id}:`);
    // No wildcard could reach the teardown by accident.
    expect(key).not.toContain("*");
  });

  it("is bound to the run secret, so it can only name this run's bucket", () => {
    // A different secret means a different HMAC, so one run's teardown can never
    // compute — and therefore never delete — another run's bucket.
    expect(demoDisabledAuthIdentifierKey("a-different-run-secret")).not.toBe(
      demoDisabledAuthIdentifierKey(RUN_SECRET),
    );
  });

  /*
   * The failure this guards is silent, which is what makes it dangerous:
   * `digestIdentifier` falls back to a known development salt when given
   * nothing, so a missing run secret would derive a *different* key, find it
   * absent, and report `observed=0 removed=0 remaining=0` while the real bucket
   * survived. A green run would hide the regression the teardown exists to
   * prevent, so the derivation refuses instead.
   */
  it("refuses a missing run secret rather than falling back to the development salt", () => {
    expect(() => demoDisabledAuthIdentifierKey(undefined)).toThrow(DEMO_DISABLED_RUN_SECRET_ENV);
  });

  it("refuses an empty run secret", () => {
    expect(() => demoDisabledAuthIdentifierKey("")).toThrow(DEMO_DISABLED_RUN_SECRET_ENV);
  });

  it("does not put the supplied secret in the refusal message", () => {
    // A refusal that echoed the value would put it in CI logs — the one place a
    // secret must never reach. The message may name the variable and the rule,
    // and nothing else.
    let message = "";
    try {
      demoDisabledAuthIdentifierKey("");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain(DEMO_DISABLED_RUN_SECRET_ENV);
    expect(message).not.toContain(RUN_SECRET);
    expect(message).not.toMatch(/[0-9a-f]{32}/);
  });

  it("never names a user or per-IP bucket", () => {
    const key = demoDisabledAuthIdentifierKey(RUN_SECRET);

    for (const policy of Object.values(RATE_LIMIT_POLICIES)) {
      if (policy.subject === "user" || policy.subject === "ip") {
        expect(key).not.toContain(`:${policy.id}:`);
      }
    }
  });
});

describe("demo-disabled teardown, configured cache with no run secret", () => {
  /**
   * The negative proof. Redis is configured — so the run really did persist a
   * bucket — but the run secret is gone. Reporting success here is the exact
   * silent failure this correction exists to prevent, so the teardown must
   * fail the run instead, and must do so before touching Redis at all.
   */
  it("fails the run rather than reporting a successful cleanup", async () => {
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:56379");
    vi.stubEnv(DEMO_DISABLED_RUN_SECRET_ENV, undefined);

    const teardown = (await import("../e2e-demo-disabled/global-teardown")).default;

    await expect(teardown()).rejects.toThrow(DEMO_DISABLED_RUN_SECRET_ENV);
    // No client was ever constructed, so nothing could be read or deleted.
    expect(redisConstructed).not.toHaveBeenCalled();
  });

  it("fails the same way on an empty run secret", async () => {
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:56379");
    vi.stubEnv(DEMO_DISABLED_RUN_SECRET_ENV, "");

    const teardown = (await import("../e2e-demo-disabled/global-teardown")).default;

    await expect(teardown()).rejects.toThrow(DEMO_DISABLED_RUN_SECRET_ENV);
    expect(redisConstructed).not.toHaveBeenCalled();
  });

  it("still returns quietly when no cache is configured, where nothing persisted", async () => {
    vi.stubEnv("REDIS_URL", undefined);
    vi.stubEnv(DEMO_DISABLED_RUN_SECRET_ENV, undefined);

    const teardown = (await import("../e2e-demo-disabled/global-teardown")).default;

    // No Redis means the limiter persisted nothing, so no secret is required
    // and there is nothing to clean — not a failure.
    await expect(teardown()).resolves.toBeUndefined();
    expect(redisConstructed).not.toHaveBeenCalled();
  });
});
