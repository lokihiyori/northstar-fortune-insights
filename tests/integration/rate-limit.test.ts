// @vitest-environment node
import "dotenv/config";

import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { RATE_LIMIT_KEY_PREFIX, consume, rateLimitKey, release } from "@/lib/rate-limit/limiter";
import {
  enforce,
  rateLimitResponse,
  releaseReservation,
  reserve,
  settleCredentialAttempt,
  type CredentialOutcome,
} from "@/lib/rate-limit/enforce";
import { policy, type RateLimitPolicy } from "@/lib/rate-limit/policies";
import { digestIdentifier, digestIp, normalizeIdentifier } from "@/lib/rate-limit/identity";

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

describe("release", () => {
  it("gives back exactly one unit", async () => {
    const p = testPolicy({ limit: 3, windowSeconds: 30 });
    const subject = `user_${randomUUID()}`;
    const key = track(p, subject);

    await consume(p, subject);
    await consume(p, subject);
    expect(Number(await redis.get(key))).toBe(2);

    await release(p, subject);
    expect(Number(await redis.get(key))).toBe(1);
  });

  it("never leaves a negative counter or a key without a TTL", async () => {
    const p = testPolicy({ limit: 3, windowSeconds: 30 });
    const subject = `user_${randomUUID()}`;
    const key = track(p, subject);

    await consume(p, subject);

    // More releases than reservations: the key must disappear rather than go
    // negative, and must never be left immortal.
    await release(p, subject);
    await release(p, subject);
    await release(p, subject);

    expect(await redis.get(key)).toBeNull();
    expect(await redis.pttl(key)).toBe(-2);
  });

  it("does nothing when the window has already expired", async () => {
    // M. A bare DECR would recreate the key at -1 with no TTL: a corrupt bucket
    // that never expires and permanently locks the subject out.
    const p = testPolicy({ limit: 3, windowSeconds: 1 });
    const subject = `user_${randomUUID()}`;
    const key = track(p, subject);

    await consume(p, subject);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(await redis.exists(key)).toBe(0);

    await release(p, subject);

    expect(await redis.exists(key), "release must not resurrect an expired key").toBe(0);
    expect(await redis.pttl(key)).toBe(-2);
  });

  it("keeps the TTL of a bucket that survives the release", async () => {
    const p = testPolicy({ limit: 5, windowSeconds: 60 });
    const subject = `user_${randomUUID()}`;
    const key = track(p, subject);

    await consume(p, subject);
    await consume(p, subject);
    await release(p, subject);

    // E. Still counted down from the original reservation, never reset.
    const ttl = await redis.pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });
});

describe("privacy of the keyspace", () => {
  it("puts no email address, local part, or domain into any key", async () => {
    const email = `private.person-${randomUUID()}@sensitive-domain.test`;
    const headers = new Headers({ "x-forwarded-for": "203.0.113.77" });

    // The real credential path, through the real policies.
    const attempt = await reserve("signIn", { headers, identifier: email });
    if (attempt.kind === "allow") {
      await settleCredentialAttempt(attempt.reservation, "invalid-credentials");
    }
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

/**
 * The credential reservation workflow, under real concurrency.
 *
 * These drive the same functions `signInAction` calls — reserve, then settle —
 * with a stand-in for password verification that records how many callers got
 * inside it. Testing only the low-level Lua would prove the counter is atomic
 * while saying nothing about whether the *gate* actually keeps concurrent
 * attempts out of the expensive path, which is the property that matters.
 */
describe("credential reservation under concurrency", () => {
  const AUTH = policy("AUTH_IDENTIFIER");

  type AttemptLog = {
    submitted: number;
    admitted: number;
    refusedBeforeVerification: number;
    committedFailures: number;
    released: number;
    unavailable: number;
  };

  function newLog(): AttemptLog {
    return {
      submitted: 0,
      admitted: 0,
      refusedBeforeVerification: 0,
      committedFailures: 0,
      released: 0,
      unavailable: 0,
    };
  }

  /**
   * One credential attempt, mirroring the action's control flow.
   *
   * `verifyMs` stands in for scrypt: it keeps every admitted caller inside the
   * expensive path long enough that a burst genuinely overlaps, so a gate that
   * only reads a count would be observed admitting all of them.
   */
  async function attemptSignIn(
    identifier: string,
    outcome: CredentialOutcome,
    log: AttemptLog,
    options: { headers?: Headers; verifyMs?: number } = {},
  ): Promise<"verified" | "refused" | "unavailable"> {
    log.submitted += 1;
    const headers = options.headers ?? new Headers();

    const attempt = await reserve("signIn", { headers, identifier });

    if (attempt.kind === "limit") {
      log.refusedBeforeVerification += 1;
      return "refused";
    }
    if (attempt.kind === "unavailable") {
      log.unavailable += 1;
      return "unavailable";
    }

    // Past the gate: this is the expensive path.
    log.admitted += 1;
    await new Promise((resolve) => setTimeout(resolve, options.verifyMs ?? 60));

    await settleCredentialAttempt(attempt.reservation, outcome);
    if (outcome === "invalid-credentials") log.committedFailures += 1;
    else log.released += 1;

    return "verified";
  }

  /**
   * The exact key for one identifier, derived the same way the enforcement layer
   * derives it. Scoped rather than globbed: several tests here run against the
   * real AUTH_IDENTIFIER policy, so a wildcard would pick up buckets belonging
   * to other tests in this file.
   */
  function authKeyFor(identifier: string): string {
    const subject = digestIdentifier(normalizeIdentifier(identifier), process.env["AUTH_SECRET"]);
    const key = rateLimitKey(AUTH.id, subject);
    createdKeys.add(key);
    return key;
  }

  it("A–F: 20 simultaneous wrong passwords admit exactly 5 and commit exactly 5", async () => {
    const identifier = `burst-${randomUUID()}@northstar.test`;
    const log = newLog();

    // A. Launch well past the limit, all at once.
    const SUBMITTED = 20;
    const results = await Promise.all(
      Array.from({ length: SUBMITTED }, () =>
        attemptSignIn(identifier, "invalid-credentials", log),
      ),
    );

    const key = authKeyFor(identifier);
    expect(await redis.exists(key), "the identifier bucket must exist").toBe(1);

    const finalCount = Number(await redis.get(key));
    const ttl = await redis.pttl(key);

    // Reported, not just asserted — this is the evidence for the report.
    console.log(
      `[credential burst] submitted=${String(log.submitted)} ` +
        `admitted=${String(log.admitted)} ` +
        `refusedBeforeVerification=${String(log.refusedBeforeVerification)} ` +
        `committedFailures=${String(log.committedFailures)} ` +
        `released=${String(log.released)} ` +
        `redisCount=${String(finalCount)} ttlMs=${String(ttl)}`,
    );

    // B. At most the allowance reaches password verification...
    expect(log.admitted).toBeLessThanOrEqual(AUTH.limit);
    // ...and because all 20 start before any finishes, it is exactly the limit.
    expect(log.admitted).toBe(AUTH.limit);

    // C. Everything else is refused before verification.
    expect(log.refusedBeforeVerification).toBe(SUBMITTED - AUTH.limit);
    expect(results.filter((result) => result === "refused")).toHaveLength(SUBMITTED - AUTH.limit);
    expect(log.unavailable).toBe(0);

    // D. Exactly the allowance is committed — not 20, and not fewer than 5.
    expect(log.committedFailures).toBe(AUTH.limit);
    expect(finalCount).toBe(SUBMITTED);
    expect(finalCount).toBeGreaterThanOrEqual(AUTH.limit);

    // E. The bucket expires on its own.
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(AUTH.windowSeconds * 1000);

    // F. And stays refused until it resets.
    const after = await reserve("signIn", { headers: new Headers(), identifier });
    expect(after.kind).toBe("limit");
    if (after.kind === "limit") expect(after.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("G: a new attempt is admitted once the window expires", async () => {
    // The real AUTH_IDENTIFIER window is 15 minutes, so expiry is exercised on a
    // policy with the same shape and a window short enough to observe.
    const shortAuth = testPolicy({
      subject: "identifier",
      limit: 2,
      windowSeconds: 1,
      counting: "reserved",
    });
    const subject = `identifier_${randomUUID()}`;
    track(shortAuth, subject);

    await consume(shortAuth, subject);
    await consume(shortAuth, subject);
    expect((await consume(shortAuth, subject)).status).toBe("limited");

    await new Promise((resolve) => setTimeout(resolve, 1300));

    const afterWindow = await consume(shortAuth, subject);
    expect(afterWindow.status).toBe("allowed");
    expect(afterWindow.remaining).toBe(1);
  });

  it("H: repeated successful sign-ins accumulate no permanent failure count", async () => {
    const identifier = `success-${randomUUID()}@northstar.test`;
    const log = newLog();

    for (let i = 0; i < AUTH.limit * 3; i += 1) {
      const result = await attemptSignIn(identifier, "authenticated", log, { verifyMs: 1 });
      expect(result, `sign-in ${String(i + 1)}`).toBe("verified");
    }

    expect(log.admitted).toBe(AUTH.limit * 3);
    expect(log.committedFailures).toBe(0);
    expect(log.released).toBe(AUTH.limit * 3);
    // Every reservation was given back, so no bucket remains at all.
    expect(await redis.exists(authKeyFor(identifier))).toBe(0);
  });

  it("I: five concurrent successes release their reservations and leave no bucket", async () => {
    const identifier = `concurrent-success-${randomUUID()}@northstar.test`;
    const log = newLog();

    await Promise.all(
      Array.from({ length: AUTH.limit }, () => attemptSignIn(identifier, "authenticated", log)),
    );

    expect(log.admitted).toBe(AUTH.limit);
    expect(log.released).toBe(AUTH.limit);
    expect(await redis.exists(authKeyFor(identifier))).toBe(0);

    // And the account is not locked afterwards.
    const next = await reserve("signIn", { headers: new Headers(), identifier });
    expect(next.kind).toBe("allow");
    if (next.kind === "allow") await releaseReservation(next.reservation);
  });

  it("J: a mixed concurrent group leaves exactly the number of definitive failures", async () => {
    const identifier = `mixed-${randomUUID()}@northstar.test`;
    const log = newLog();

    // Three genuine failures and two successes, all at once, inside the
    // allowance so none of them is refused.
    const outcomes: CredentialOutcome[] = [
      "invalid-credentials",
      "authenticated",
      "invalid-credentials",
      "authenticated",
      "invalid-credentials",
    ];

    await Promise.all(outcomes.map((outcome) => attemptSignIn(identifier, outcome, log)));

    const key = authKeyFor(identifier);
    const count = Number(await redis.get(key));

    expect(log.admitted).toBe(5);
    expect(log.committedFailures).toBe(3);
    expect(log.released).toBe(2);
    // The two successes gave back their own units and nothing more, so the three
    // real failures survive intact.
    expect(count).toBe(3);
    expect(await redis.pttl(key)).toBeGreaterThan(0);
  });

  it("K: with a trusted proxy, both the address and the account bucket apply", async () => {
    vi.stubEnv("RATE_LIMIT_TRUSTED_PROXY_HOPS", "1");

    try {
      const address = `203.0.113.${String(20 + Math.floor(Math.random() * 200))}`;
      const headers = new Headers({ "x-forwarded-for": address });
      const log = newLog();

      // Each attempt uses a different account, so only the address bucket can
      // accumulate. AUTH_IP allows 20.
      const ipPolicy = policy("AUTH_IP");
      for (let i = 0; i < ipPolicy.limit; i += 1) {
        const result = await attemptSignIn(
          `spray-${String(i)}-${randomUUID()}@northstar.test`,
          "invalid-credentials",
          log,
          { headers, verifyMs: 1 },
        );
        expect(result, `spray attempt ${String(i + 1)}`).toBe("verified");
      }

      for (const key of await redis.keys(`${RATE_LIMIT_KEY_PREFIX}:${ipPolicy.id}:*`)) {
        createdKeys.add(key);
      }

      // The address budget is now spent, even though every account was fresh.
      const refused = await attemptSignIn(
        `spray-final-${randomUUID()}@northstar.test`,
        "invalid-credentials",
        log,
        { headers, verifyMs: 1 },
      );
      expect(refused).toBe("refused");
      expect(log.admitted).toBe(ipPolicy.limit);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("L: a denial in the second policy releases the reservation taken by the first", async () => {
    vi.stubEnv("RATE_LIMIT_TRUSTED_PROXY_HOPS", "1");

    try {
      const identifier = `rollback-${randomUUID()}@northstar.test`;
      const address = "198.51.100.77";
      const headers = new Headers({ "x-forwarded-for": address });
      const ipPolicy = policy("AUTH_IP");

      // Exhaust the *account* bucket first, using no address at all so the
      // address bucket stays untouched.
      const bare = new Headers();
      for (let i = 0; i < AUTH.limit; i += 1) {
        const attempt = await reserve("signIn", { headers: bare, identifier });
        expect(attempt.kind).toBe("allow");
        if (attempt.kind === "allow") {
          await settleCredentialAttempt(attempt.reservation, "invalid-credentials");
        }
      }

      // The exact address bucket, derived the same way the enforcement layer
      // does — this address has never been used, so it must not exist yet.
      const ipKey = rateLimitKey(ipPolicy.id, digestIp(address, process.env["AUTH_SECRET"]));
      createdKeys.add(ipKey);
      createdKeys.add(authKeyFor(identifier));

      expect(await redis.exists(ipKey), "the address bucket must start empty").toBe(0);

      // Now attempt with an address. AUTH_IP is reserved first and would allow;
      // AUTH_IDENTIFIER then denies, so the address reservation must be handed
      // back rather than left charged against an innocent address.
      const denied = await reserve("signIn", { headers, identifier });
      expect(denied.kind).toBe("limit");

      // The decisive assertion: the rolled-back reservation left nothing behind.
      // Without the rollback this key would exist with a count of 1, charging an
      // address that never got as far as a password check.
      expect(await redis.exists(ipKey), "the rolled-back reservation must not persist").toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("N: a Redis outage refuses the attempt without running verification", async () => {
    vi.resetModules();
    forgetCachedRedisClient();
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6392");

    try {
      const offline = await import("@/lib/rate-limit/enforce");

      const attempt = await offline.reserve("signIn", {
        headers: new Headers(),
        identifier: `outage-${randomUUID()}@northstar.test`,
      });

      // Fail-closed: no reservation, so verification must not run.
      expect(attempt.kind).toBe("unavailable");

      const response = offline.rateLimitResponse(attempt);
      expect(response?.status).toBe(503);
      const body = (await response?.json()) as { error: { code: string } };
      expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
      // Never reported as a rate limit.
      expect(body.error.code).not.toBe("RATE_LIMITED");

      const client = await import("@/lib/redis/client");
      client.getRedis()?.disconnect();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      await restoreHealthyRedisClient();
    }
  });

  it("N: releasing during an outage cannot corrupt the bucket", async () => {
    const p = testPolicy({ limit: 2, windowSeconds: 30 });
    const subject = `user_${randomUUID()}`;
    const key = track(p, subject);

    await consume(p, subject);

    vi.resetModules();
    forgetCachedRedisClient();
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6392");

    try {
      const offline = await import("@/lib/rate-limit/limiter");
      // Must not throw, and must not be able to write anything.
      await offline.release(p, subject);

      const client = await import("@/lib/redis/client");
      client.getRedis()?.disconnect();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      await restoreHealthyRedisClient();
    }

    // The reservation stays counted — the documented fail-safe — and the TTL
    // still bounds it, so nothing is locked out permanently.
    expect(Number(await redis.get(key))).toBe(1);
    expect(await redis.pttl(key)).toBeGreaterThan(0);
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

  it("charges a failed sign-in and refunds a successful one", async () => {
    const identifier = `attempts-${randomUUID()}@northstar.test`;
    const headers = new Headers();
    const auth = policy("AUTH_IDENTIFIER");

    for (let attempt = 0; attempt < auth.limit; attempt += 1) {
      const reserved = await reserve("signIn", { headers, identifier });
      expect(reserved.kind, `attempt ${String(attempt + 1)}`).toBe("allow");
      if (reserved.kind === "allow") {
        await settleCredentialAttempt(reserved.reservation, "invalid-credentials");
      }
    }

    for (const key of await redis.keys(`${RATE_LIMIT_KEY_PREFIX}:auth_identifier:*`)) {
      createdKeys.add(key);
    }

    const refused = await reserve("signIn", { headers, identifier });
    expect(refused.kind).toBe("limit");

    // A different account is not affected by the locked one.
    const other = `other-${randomUUID()}@northstar.test`;
    const otherAttempt = await reserve("signIn", { headers, identifier: other });
    expect(otherAttempt.kind).toBe("allow");
    if (otherAttempt.kind === "allow") {
      // A success gives its unit straight back, leaving no trace.
      await settleCredentialAttempt(otherAttempt.reservation, "authenticated");
    }
    expect(
      await redis.exists(...(await redis.keys(`${RATE_LIMIT_KEY_PREFIX}:auth_identifier:*`))),
    ).toBeGreaterThan(0);
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

/**
 * Rebuilds the shared client and waits until it can actually take commands.
 *
 * Without this, the test immediately after an outage test issues its first
 * command while the replacement socket is still connecting. `enableOfflineQueue`
 * is false, so that command is rejected and the limiter correctly reports an
 * outage — a real behaviour, but not the one under test.
 */
async function restoreHealthyRedisClient(): Promise<void> {
  forgetCachedRedisClient();
  const { getRedis } = await import("@/lib/redis/client");
  const client = getRedis();
  if (client && client.status !== "ready") {
    await new Promise<void>((resolve) => {
      client.once("ready", () => {
        resolve();
      });
    });
  }
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
      await restoreHealthyRedisClient();
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
      await restoreHealthyRedisClient();
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
