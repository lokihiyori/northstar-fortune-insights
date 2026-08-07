import "server-only";

import { createHash } from "node:crypto";
import { getRedis } from "@/lib/redis/client";
import { retryAfterSeconds, type RateLimitPolicy } from "./policies";

/**
 * Distributed fixed-window rate limiting on Redis.
 *
 * **Why a Lua script.** `INCR` then `EXPIRE` as two commands has a real failure
 * mode: if the process dies between them the key survives with no TTL, and that
 * subject is locked out permanently. Running both inside one script makes the
 * pair atomic — Redis executes a script to completion without interleaving
 * another client's commands.
 *
 * **Why the TTL is only set on the first increment.** Refreshing it on every
 * call would let a subject under sustained load extend their own window
 * forever, so the window would never reset while they kept knocking.
 *
 * **Fixed window, knowingly.** Up to `2 × limit` requests can land across a
 * window boundary. That is acceptable for an abuse ceiling and costs one
 * integer per subject; a sliding window needs a sorted set per subject and far
 * more memory for a bound that is no more meaningful here.
 *
 * This module is the only place that talks to Redis for limiting, and it never
 * throws: an outage is reported as `unavailable` so the caller can apply its
 * policy's failure mode rather than guessing.
 */

/** Namespaced and versioned: `v1` can be retired without touching cache keys. */
export const RATE_LIMIT_KEY_PREFIX = "northstar:rl:v1";

const LUA_CONSUME = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return { current, redis.call('PTTL', KEYS[1]) }
`;

const LUA_CONSUME_SHA = createHash("sha1").update(LUA_CONSUME).digest("hex");

export type RateLimitStatus =
  /** Within the allowance. */
  | "allowed"
  /** The allowance is used up. */
  | "limited"
  /** Redis could not answer. The caller applies the policy's failure mode. */
  | "unavailable";

export type RateLimitResult = {
  status: RateLimitStatus;
  /** True only for `allowed`. `unavailable` is never an implicit yes. */
  allowed: boolean;
  policyId: string;
  limit: number;
  /** Attempts left in this window. Zero when limited or unavailable. */
  remaining: number;
  /** When the current window ends. */
  resetAt: Date;
  /** Whole seconds for a `Retry-After` header. Zero when not limited. */
  retryAfterSeconds: number;
};

/**
 * The Redis key for a subject under a policy.
 *
 * Exported so tests can clean up by exact key rather than scanning. The subject
 * is already a digest or an opaque id — see `identity.ts`; nothing readable
 * about a person reaches this string.
 */
export function rateLimitKey(policyId: string, subject: string): string {
  return `${RATE_LIMIT_KEY_PREFIX}:${policyId}:${subject}`;
}

function unavailable(policy: RateLimitPolicy): RateLimitResult {
  return {
    status: "unavailable",
    allowed: false,
    policyId: policy.id,
    limit: policy.limit,
    remaining: 0,
    resetAt: new Date(),
    retryAfterSeconds: 0,
  };
}

/**
 * `countIncludesAttempt` is the difference between the two callers, and getting
 * it wrong is an off-by-one that grants an extra attempt.
 *
 * `consume` has already incremented, so its count includes the attempt being
 * judged and the test is `count > limit`. `peek` reads the count *before* an
 * attempt, so a subject that has already used the whole allowance must be
 * refused now: `count >= limit`.
 */
function decide(
  policy: RateLimitPolicy,
  count: number,
  ttlMs: number,
  countIncludesAttempt: boolean,
): RateLimitResult {
  // A missing or already-expired TTL means the window is effectively over.
  const remainingMs = ttlMs > 0 ? ttlMs : policy.windowSeconds * 1000;
  const resetAt = new Date(Date.now() + remainingMs);

  const exceeded = countIncludesAttempt ? count > policy.limit : count >= policy.limit;

  if (exceeded) {
    return {
      status: "limited",
      allowed: false,
      policyId: policy.id,
      limit: policy.limit,
      remaining: 0,
      resetAt,
      retryAfterSeconds: retryAfterSeconds(remainingMs),
    };
  }

  return {
    status: "allowed",
    allowed: true,
    policyId: policy.id,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - count),
    resetAt,
    retryAfterSeconds: 0,
  };
}

/** Reads the `{ count, pttl }` pair a script or pipeline returned. */
function readPair(raw: unknown): { count: number; ttlMs: number } | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const count = Number(raw[0]);
  const ttlMs = Number(raw[1]);
  if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) return null;
  return { count, ttlMs };
}

/**
 * Counts one attempt against the policy and returns the resulting decision.
 *
 * The increment happens whether or not the attempt is allowed, which is what
 * makes a sustained attacker stay locked out for the rest of the window.
 */
export async function consume(policy: RateLimitPolicy, subject: string): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) return unavailable(policy);

  const key = rateLimitKey(policy.id, subject);
  const windowMs = String(policy.windowSeconds * 1000);

  try {
    let raw: unknown;
    try {
      // EVALSHA first so the script body is not resent on every request.
      raw = await redis.evalsha(LUA_CONSUME_SHA, 1, key, windowMs);
    } catch (error) {
      // NOSCRIPT simply means this Redis has not cached it yet — send it once.
      if (!(error instanceof Error) || !error.message.includes("NOSCRIPT")) throw error;
      raw = await redis.eval(LUA_CONSUME, 1, key, windowMs);
    }

    const pair = readPair(raw);
    if (!pair) return unavailable(policy);

    return decide(policy, pair.count, pair.ttlMs, true);
  } catch {
    // Never surfaces the driver error: a connection string can carry credentials.
    return unavailable(policy);
  }
}

/**
 * Reads the current state without consuming an attempt.
 *
 * Used by `on-failure` policies, which must know whether a subject is already
 * locked out before an attempt is made, but must not charge them for an attempt
 * that turns out to be a legitimate success.
 */
export async function peek(policy: RateLimitPolicy, subject: string): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) return unavailable(policy);

  const key = rateLimitKey(policy.id, subject);

  try {
    const [countRaw, ttlRaw] = await redis
      .multi()
      .get(key)
      .pttl(key)
      .exec()
      .then((replies) => [replies?.[0]?.[1], replies?.[1]?.[1]] as const);

    const count = Number(countRaw ?? 0);
    const ttlMs = Number(ttlRaw ?? 0);
    if (!Number.isFinite(count)) return unavailable(policy);

    return decide(policy, count, Number.isFinite(ttlMs) ? ttlMs : 0, false);
  } catch {
    return unavailable(policy);
  }
}

/**
 * Clears a subject's bucket.
 *
 * Not currently used on any request path — the `on-failure` counting mode makes
 * a post-success reset unnecessary, because a success never consumed anything.
 * Exported for deterministic test cleanup and for operational recovery.
 */
export async function reset(policy: RateLimitPolicy, subject: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(rateLimitKey(policy.id, subject));
  } catch {
    // Clearing a limit is best-effort; the window expires on its own.
  }
}
