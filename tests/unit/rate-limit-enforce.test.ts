import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Enforcement decisions and how they become responses.
 *
 * Redis is replaced with a controllable stub so the failure modes can be
 * exercised without a server: the point of these tests is that a Redis outage
 * on a fail-closed operation is reported as an outage, and never as a
 * rate-limit event that would tell a user to wait out a window that does not
 * exist.
 */

let redisAvailable = false;

vi.mock("@/lib/redis/client", () => ({
  getRedis: () => (redisAvailable ? {} : null),
  cacheGet: async () => null,
  cacheSet: async () => undefined,
  cacheIncrement: async () => null,
}));

const { RATE_LIMITED_MESSAGE, UNAVAILABLE_MESSAGE, actionLimitResult, enforce, rateLimitResponse } =
  await import("@/lib/rate-limit/enforce");

const HEADERS = new Headers();

beforeEach(() => {
  redisAvailable = false;
  vi.unstubAllEnvs();
});

describe("failure mode when Redis cannot answer", () => {
  it("refuses a fail-closed operation instead of allowing it through", async () => {
    const decision = await enforce("guidanceGeneration", { headers: HEADERS, userId: "user_1" });
    expect(decision.kind).toBe("unavailable");
  });

  it("refuses credential sign-in", async () => {
    const decision = await enforce("signIn", {
      headers: HEADERS,
      identifier: "person@example.com",
    });
    expect(decision.kind).toBe("unavailable");
  });

  it("refuses admin mutations", async () => {
    const decision = await enforce("adminMutation", { headers: HEADERS, userId: "admin_1" });
    expect(decision.kind).toBe("unavailable");
  });

  it("still serves an ordinary read", async () => {
    const decision = await enforce("accountRead", { headers: HEADERS, userId: "user_1" });
    expect(decision.kind).toBe("allow");
  });
});

describe("subject resolution", () => {
  it("skips a policy with no subject rather than sharing one bucket", async () => {
    // No user id and no trusted address: every policy for this operation has
    // nothing to count, so nothing is evaluated and nothing is refused.
    const decision = await enforce("guidanceGeneration", { headers: HEADERS });
    expect(decision.kind).toBe("allow");
  });

  it("skips per-address policies when no proxy is trusted", async () => {
    // Sign-up has an address policy and an account policy. With a forwarded
    // header present but no declared proxy, only the account policy can apply —
    // and with Redis down that one fails closed.
    const spoofed = new Headers({ "x-forwarded-for": "203.0.113.5" });

    const withoutIdentifier = await enforce("signUp", { headers: spoofed });
    expect(withoutIdentifier.kind, "address alone must not produce a subject").toBe("allow");

    const withIdentifier = await enforce("signUp", {
      headers: spoofed,
      identifier: "person@example.com",
    });
    expect(withIdentifier.kind).toBe("unavailable");
  });

  it("uses a trusted address once a proxy hop count is declared", async () => {
    vi.stubEnv("RATE_LIMIT_TRUSTED_PROXY_HOPS", "1");
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5" });

    const decision = await enforce("signUp", { headers });
    // Now the address policy has a subject, so the outage is reported.
    expect(decision.kind).toBe("unavailable");
  });
});

describe("response mapping", () => {
  const limited = {
    kind: "limit" as const,
    policyId: "auth_identifier",
    retryAfterSeconds: 42,
    resetAt: new Date(Date.now() + 42_000),
  };

  const unavailable = { kind: "unavailable" as const, policyId: "auth_identifier" };

  it("returns nothing to send when the request is allowed", () => {
    expect(rateLimitResponse({ kind: "allow" })).toBeNull();
    expect(actionLimitResult({ kind: "allow" })).toBeNull();
  });

  it("maps an exceeded limit to 429 with Retry-After", async () => {
    const response = rateLimitResponse(limited);

    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("42");

    const body = (await response?.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.requestId).toBeTruthy();
  });

  it("maps a fail-closed outage to 503, not to 429", async () => {
    const response = rateLimitResponse(unavailable);

    expect(response?.status).toBe(503);

    const body = (await response?.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.error.requestId).toBeTruthy();
  });

  it("gives an action the same generic message the API returns", () => {
    expect(actionLimitResult(limited)?.message).toBe(RATE_LIMITED_MESSAGE);
    expect(actionLimitResult(unavailable)?.message).toBe(UNAVAILABLE_MESSAGE);
    expect(actionLimitResult(limited)?.retryAfterSeconds).toBe(42);
  });
});

describe("non-disclosure", () => {
  it("never names the policy, the limit, the window, or the bucket", async () => {
    const responses = [
      rateLimitResponse({
        kind: "limit",
        policyId: "auth_identifier",
        retryAfterSeconds: 42,
        resetAt: new Date(),
      }),
      rateLimitResponse({ kind: "unavailable", policyId: "auth_identifier" }),
    ];

    for (const response of responses) {
      const text = JSON.stringify(await response?.json());
      expect(text).not.toContain("auth_identifier");
      expect(text).not.toContain("northstar:rl");
      expect(text).not.toContain("redis");
      expect(text).not.toContain("Redis");
      expect(text).not.toContain("limit=");
    }
  });

  it("says the same thing whichever operation was limited", () => {
    // A sign-in form must answer identically for a real account and an
    // unregistered address, or the limit becomes an enumeration oracle.
    const forAccount = actionLimitResult({
      kind: "limit",
      policyId: "auth_identifier",
      retryAfterSeconds: 30,
      resetAt: new Date(),
    });
    const forAddress = actionLimitResult({
      kind: "limit",
      policyId: "auth_ip",
      retryAfterSeconds: 30,
      resetAt: new Date(),
    });

    expect(forAccount?.message).toBe(forAddress?.message);
    expect(forAccount?.message).not.toMatch(/account|email|address|exist/i);
  });

  it("never puts a credential or address in the message", () => {
    expect(RATE_LIMITED_MESSAGE).not.toMatch(/@|password|token/i);
    expect(UNAVAILABLE_MESSAGE).not.toMatch(/@|password|token|redis/i);
  });
});
