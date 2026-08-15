import { describe, expect, it } from "vitest";

import { RATE_LIMIT_KEY_PREFIX, rateLimitKey } from "@/lib/rate-limit/limiter";
import { RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";
import { digestIdentifier, normalizeIdentifier } from "@/lib/rate-limit/identity";
import {
  DEMO_DISABLED_PROBE_EMAIL,
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

  it("never names a user or per-IP bucket", () => {
    const key = demoDisabledAuthIdentifierKey(RUN_SECRET);

    for (const policy of Object.values(RATE_LIMIT_POLICIES)) {
      if (policy.subject === "user" || policy.subject === "ip") {
        expect(key).not.toContain(`:${policy.id}:`);
      }
    }
  });
});
