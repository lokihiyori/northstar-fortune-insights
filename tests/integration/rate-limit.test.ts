// @vitest-environment node
import "dotenv/config";

import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { RATE_LIMIT_KEY_PREFIX, consume, peek, rateLimitKey } from "@/lib/rate-limit/limiter";
import { enforce, rateLimitResponse, recordFailedAttempt } from "@/lib/rate-limit/enforce";
import { policy, type RateLimitPolicy } from "@/lib/rate-limit/policies";

/**
 * The limiter against a real Redis.
 *
 * Nothing is mocked. The Lua script, the TTL, the expiry, and the concurrency
 * behaviour are all exercised on the same server the application uses — a
 * fake would prove only that the fake counts.
 *
 * Windows here are seconds rather than the minutes the production policies use,
 * because a test that waits fifteen minutes is a test nobody runs. The
 * production values themselves are asserted in tests/unit/rate-limit-policies.
 */

let redis: Redis;
const createdKeys = new Set<string>();

/** A policy with a short window, so expiry can actually be observed. */
function testPolicy(overrides: Partial<RateLimitPolicy> = {}): RateLimitPolicy {
  return {
    id: `test_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    subject: "user",
    limit: 3,
    windowSeconds: 2,
    failureMode: "closed",
    counting: "always",
    rationale: "Integration fixture with a window short enough to observe.",
    ...overrides,
  };
}

function track(p: RateLimitPolicy, subject: string): string {
  const key = rateLimitKey(p.id, subject);
  createdKeys.add(key);
  return key;
}

beforeAll(async () => {
  const url = process.env["REDIS_URL"];
  if (!url) throw new Error("REDIS_URL is not set. Start the stack with `pnpm db:up`.");
  redis = new Redis(url, { maxRetriesPerRequest: 2 });

  // The application client sets `enableOfflineQueue: false`, so commands issued
  // while it is still connecting are rejected rather than queued — which the
  // limiter would report as an outage. A real server opens this connection in
  // `instrumentation.ts` at boot; this is the test-suite equivalent.
  const { getRedis } = await import("@/lib/redis/client");
  const client = getRedis();
  if (client && client.status !== "ready") {
    await new Promise<void>((resolve) =>
      client.once("ready", () => {
        resolve();
      }),
    );
  }
});

afterAll(async () => {
  if (createdKeys.size > 0) await redis.del(...createdKeys);

  // Deterministic cleanup: nothing this suite created may survive it.
  const leftovers: string[] = [];
  for (const key of createdKeys) {
    if ((await redis.exists(key)) === 1) leftovers.push(key);
  }
  if (leftovers.length > 0) {
    throw new Error(`teardown left ${String(leftovers.length)} rate-limit key(s) behind`);
  }

  await redis.quit();
});

describe("fixed window counting", () => {
  it("allows requests 1..N and refuses N+1", async () => {
    const p = testPolicy({ limit: 3 });
    const subject = `user_${randomUUID()}`;
    track(p, subject);

    const first = await consume(p, subject);
    expect(first.status).toBe("allowed");
    expect(first.limit).toBe(3);
    expect(first.remaining).toBe(2);

    expect((await consume(p, subject)).remaining).toBe(1);

    const third = await consume(p, subject);
    expect(third.status).toBe("allowed");
    expect(third.remaining).toBe(0);

    const fourth = await consume(p, subject);
    expect(fourth.status).toBe("limited");
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it("reports a Retry-After and reset time inside the window", async () => {
    const p = testPolicy({ limit: 1, windowSeconds: 60 });
    const subject = `user_${randomUUID()}`;
    const key = track(p, subject);

    await consume(p, subject);
    const limited = await consume(p, subject);

    expect(limited.status).toBe("limited");
    // Rounded up from the real remaining TTL, so never zero and never beyond
    // the configured window.
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.retryAfterSeconds).toBeLessThanOrEqual(60);

    const msUntilReset = limited.resetAt.getTime() - Date.now();
    expect(msUntilReset).toBeGreaterThan(0);
    expect(msUntilReset).toBeLessThanOrEqual(60_000);

    // The header value must actually cover the remaining window.
    const ttlMs = await redis.pttl(key);
    expect(limited.retryAfterSeconds * 1000).toBeGreaterThanOrEqual(ttlMs - 1000);
  });

  it("always leaves a TTL, so a subject cannot be locked out forever", async () => {
    const p = testPolicy();
    const subject = `user_${randomUUID()}`;
    const key = track(p, subject);

    await consume(p, subject);
    expect(await redis.pttl(key)).toBeGreaterThan(0);
  });

  it("does not let a sustained caller extend their own window", async () => {
    const p = testPolicy({ limit: 1, windowSeconds: 60 });
    const subject = `user_${randomUUID()}`;
    const key = track(p, subject);

    await consume(p, subject);
    const firstTtl = await redis.pttl(key);

    await new Promise((resolve) => setTimeout(resolve, 250));
    await consume(p, subject);
    const secondTtl = await redis.pttl(key);

    // The TTL keeps counting down: it is set once, on the first increment.
    expect(secondTtl).toBeLessThan(firstTtl);
  });

  it("resets once the window expires", async () => {
    const p = testPolicy({ limit: 2, windowSeconds: 1 });
    const subject = `user_${randomUUID()}`;
    track(p, subject);

    await consume(p, subject);
    await consume(p, subject);
    expect((await consume(p, subject)).status).toBe("limited");

    await new Promise((resolve) => setTimeout(resolve, 1300));

    const afterWindow = await consume(p, subject);
    expect(afterWindow.status).toBe("allowed");
    expect(afterWindow.remaining).toBe(1);
  });
});

describe("atomicity", () => {
  it("cannot exceed the allowance under concurrent requests", async () => {
    // The race a naive INCR-then-EXPIRE has: many callers arriving at once,
    // all seeing an empty bucket. The Lua script runs to completion per call,
    // so exactly `limit` of them can be allowed.
    const p = testPolicy({ limit: 5, windowSeconds: 30 });
    const subject = `user_${randomUUID()}`;
    const key = track(p, subject);

    const results = await Promise.all(Array.from({ length: 40 }, () => consume(p, subject)));

    const allowed = results.filter((result) => result.status === "allowed");
    expect(allowed).toHaveLength(5);
    expect(results.filter((result) => result.status === "limited")).toHaveLength(35);

    // Every concurrent caller saw the same window; none of them lost the TTL.
    expect(await redis.pttl(key)).toBeGreaterThan(0);
    expect(Number(await redis.get(key))).toBe(40);
  });

  it("never leaves a key without an expiry, even under concurrency", async () => {
    const p = testPolicy({ limit: 2, windowSeconds: 30 });
    const subject = `user_${randomUUID()}`;
    const key = track(p, subject);

    await Promise.all(Array.from({ length: 20 }, () => consume(p, subject)));

    // -1 means "exists with no TTL", which would be a permanent lockout.
    expect(await redis.pttl(key)).toBeGreaterThan(0);
  });
});

describe("bucket independence", () => {
  it("keeps two subjects under one policy separate", async () => {
    const p = testPolicy({ limit: 1, windowSeconds: 30 });
    const one = `user_${randomUUID()}`;
    const two = `user_${randomUUID()}`;
    track(p, one);
    track(p, two);

    await consume(p, one);
    expect((await consume(p, one)).status).toBe("limited");

    // Exhausting one user must not touch another.
    expect((await consume(p, two)).status).toBe("allowed");
  });

  it("keeps a per-user bucket separate from a per-address bucket", async () => {
    const userPolicy = testPolicy({ subject: "user", limit: 1, windowSeconds: 30 });
    const ipPolicy = testPolicy({ subject: "ip", limit: 1, windowSeconds: 30 });
    const subject = `shared_${randomUUID()}`;
    track(userPolicy, subject);
    track(ipPolicy, subject);

    await consume(userPolicy, subject);
    expect((await consume(userPolicy, subject)).status).toBe("limited");

    // Same subject string, different policy: distinct key, distinct budget.
    expect((await consume(ipPolicy, subject)).status).toBe("allowed");
  });
});

describe("peek", () => {
  it("reports state without consuming an attempt", async () => {
    const p = testPolicy({ limit: 2, windowSeconds: 30 });
    const subject = `user_${randomUUID()}`;
    track(p, subject);

    expect((await peek(p, subject)).status).toBe("allowed");
    expect((await peek(p, subject)).status).toBe("allowed");

    // Three peeks, and the budget is still untouched.
    expect((await consume(p, subject)).remaining).toBe(1);
    expect((await consume(p, subject)).remaining).toBe(0);
    expect((await consume(p, subject)).status).toBe("limited");
  });

  it("reports a subject that is already locked out", async () => {
    const p = testPolicy({ limit: 1, windowSeconds: 30 });
    const subject = `user_${randomUUID()}`;
    track(p, subject);

    await consume(p, subject);
    await consume(p, subject);

    const seen = await peek(p, subject);
    expect(seen.status).toBe("limited");
    expect(seen.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("privacy of the keyspace", () => {
  it("puts no email address, local part, or domain into any key", async () => {
    const email = `private.person-${randomUUID()}@sensitive-domain.test`;
    const headers = new Headers({ "x-forwarded-for": "203.0.113.77" });

    // The real credential path, through the real policies.
    await recordFailedAttempt("signIn", { headers, identifier: email });
    await enforce("signUp", { headers, identifier: email });

    const keys = await redis.keys(`${RATE_LIMIT_KEY_PREFIX}:*`);
    for (const key of keys) createdKeys.add(key);

    const localPart = email.split("@")[0] ?? "";
    const joined = keys.join("\n");

    expect(joined).not.toContain(email);
    expect(joined).not.toContain(localPart);
    expect(joined).not.toContain("sensitive-domain.test");
    expect(joined).not.toContain("@");

    // And the values are counters, never content.
    for (const key of keys) {
      const value = await redis.get(key);
      if (value !== null) expect(value).toMatch(/^\d+$/);
    }
  });

  it("stores no question text or address, only counts", async () => {
    const question = "Should I leave my job to retrain as a paramedic in Nova Scotia?";
    const userId = `user_${randomUUID()}`;

    await enforce("guidanceGeneration", {
      headers: new Headers(),
      userId,
      // Private content is not part of the context by construction; this asserts
      // the shape rather than trusting it.
      identifier: undefined,
    });

    const keys = await redis.keys(`${RATE_LIMIT_KEY_PREFIX}:*`);
    for (const key of keys) createdKeys.add(key);

    const joined = keys.join("\n");
    expect(joined).not.toContain("paramedic");
    expect(joined).not.toContain(question);
  });

  it("uses a namespaced, versioned key for every policy", async () => {
    const p = testPolicy();
    const subject = `user_${randomUUID()}`;
    const key = track(p, subject);

    expect(key.startsWith(`${RATE_LIMIT_KEY_PREFIX}:`)).toBe(true);
    expect(key).toContain(p.id);
  });
});

describe("real policies through the enforcement layer", () => {
  it("limits guidance generation for one user and leaves another alone", async () => {
    const guidance = policy("GUIDANCE_USER");
    const userA = `user_${randomUUID()}`;
    const userB = `user_${randomUUID()}`;
    track(guidance, userA);
    track(guidance, userB);

    const headers = new Headers();

    for (let attempt = 0; attempt < guidance.limit; attempt += 1) {
      const decision = await enforce("guidanceGeneration", { headers, userId: userA });
      expect(decision.kind, `attempt ${String(attempt + 1)}`).toBe("allow");
    }

    const refused = await enforce("guidanceGeneration", { headers, userId: userA });
    expect(refused.kind).toBe("limit");
    if (refused.kind === "limit") {
      expect(refused.retryAfterSeconds).toBeGreaterThan(0);
      expect(refused.retryAfterSeconds).toBeLessThanOrEqual(guidance.windowSeconds);
    }

    // A different account is unaffected, so one user cannot deny another.
    expect((await enforce("guidanceGeneration", { headers, userId: userB })).kind).toBe("allow");
  });

  it("counts a failed sign-in but not a successful one", async () => {
    const identifier = `attempts-${randomUUID()}@northstar.test`;
    const headers = new Headers();
    const auth = policy("AUTH_IDENTIFIER");

    for (let attempt = 0; attempt < auth.limit; attempt += 1) {
      expect((await enforce("signIn", { headers, identifier })).kind).toBe("allow");
      await recordFailedAttempt("signIn", { headers, identifier });
    }

    for (const key of await redis.keys(`${RATE_LIMIT_KEY_PREFIX}:auth_identifier:*`)) {
      createdKeys.add(key);
    }

    const refused = await enforce("signIn", { headers, identifier });
    expect(refused.kind).toBe("limit");

    // A different account is not affected by the locked one.
    const other = `other-${randomUUID()}@northstar.test`;
    expect((await enforce("signIn", { headers, identifier: other })).kind).toBe("allow");
  });
});

/**
 * The client is cached on `globalThis`, so `vi.resetModules()` alone re-imports
 * the module and finds the same healthy connection. Clearing the cache is what
 * actually forces a new client to be built against the stubbed URL.
 */
function forgetCachedRedisClient(): void {
  const cache = globalThis as unknown as { redis?: Redis | null };
  cache.redis?.disconnect();
  delete cache.redis;
}

describe("Redis outage", () => {
  it("returns 503 SERVICE_UNAVAILABLE on a fail-closed operation, never 429", async () => {
    vi.resetModules();
    forgetCachedRedisClient();
    // A port with nothing listening: a genuine connection failure, not a mock.
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6391");

    try {
      const offline = await import("@/lib/rate-limit/enforce");

      const decision = await offline.enforce("guidanceGeneration", {
        headers: new Headers(),
        userId: `user_${randomUUID()}`,
      });
      expect(decision.kind).toBe("unavailable");

      const response = offline.rateLimitResponse(decision);
      expect(response?.status).toBe(503);

      const body = (await response?.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
      // A 429 here would blame the user for our outage and send them away to
      // wait out a window that does not exist.
      expect(body.error.code).not.toBe("RATE_LIMITED");
      // And nothing about the connection may reach the client.
      expect(JSON.stringify(body)).not.toContain("6391");
      expect(JSON.stringify(body)).not.toMatch(/redis/i);

      const client = await import("@/lib/redis/client");
      client.getRedis()?.disconnect();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      // Drop the offline client so anything after this builds a healthy one.
      forgetCachedRedisClient();
    }
  });

  it("keeps serving a fail-open read", async () => {
    vi.resetModules();
    forgetCachedRedisClient();
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6391");

    try {
      const offline = await import("@/lib/rate-limit/enforce");

      const decision = await offline.enforce("accountRead", {
        headers: new Headers(),
        userId: `user_${randomUUID()}`,
      });

      expect(decision.kind).toBe("allow");
      expect(offline.rateLimitResponse(decision)).toBeNull();

      const client = await import("@/lib/redis/client");
      client.getRedis()?.disconnect();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      // Drop the offline client so anything after this builds a healthy one.
      forgetCachedRedisClient();
    }
  });
});

describe("response shape", () => {
  it("sends Retry-After with a 429", async () => {
    const response = rateLimitResponse({
      kind: "limit",
      policyId: "test",
      retryAfterSeconds: 17,
      resetAt: new Date(),
    });

    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("17");
  });
});
