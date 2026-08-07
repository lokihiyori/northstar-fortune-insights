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
 * The count always *includes* the attempt being judged, because the only way to
 * ask is to reserve first. So the test is `count > limit`, not `count >= limit`.
 */
function decide(policy: RateLimitPolicy, count: number, ttlMs: number): RateLimitResult {
  // A missing or already-expired TTL means the window is effectively over.
  const remainingMs = ttlMs > 0 ? ttlMs : policy.windowSeconds * 1000;
  const resetAt = new Date(Date.now() + remainingMs);

  if (count > policy.limit) {
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
 * Reserves one attempt against the policy and returns the resulting decision.
 *
 * This is the *gate*, not a report: capacity is taken before the caller does any
 * expensive work, so no more than `limit` callers can be inside that work at
 * once however many arrive simultaneously. Callers that turn out not to owe the
 * attempt give it back with `release`.
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

    return decide(policy, pair.count, pair.ttlMs);
  } catch {
    // Never surfaces the driver error: a connection string can carry credentials.
    return unavailable(policy);
  }
}

/**
 * Gives back one previously consumed attempt.
 *
 * This is the other half of the reservation model: `consume` reserves capacity
 * *before* expensive work, and this returns it when the work turns out not to
 * have been a failure worth counting — a successful sign-in, or an
 * infrastructure error that says nothing about the caller.
 *
 * There is no `peek`-based gate any more. Reading a count and then acting on it
 * is not atomic: many concurrent callers all read the same pre-attempt value and
 * are all admitted, so one burst can exceed the limit. Reserving first makes the
 * gate itself atomic.
 *
 * The script is written so a release can never do damage:
 *
 * - **Key already gone** (window expired, or cleared): do nothing. A bare `DECR`
 *   would recreate it at `-1` with no TTL — a corrupt bucket that never expires.
 * - **Count would reach zero or below**: delete the key instead of storing a
 *   zero or negative value.
 * - **Key somehow has no TTL**: restore one rather than leaving it immortal.
 *
 * A release only ever removes *one* unit — the caller's own reservation — so a
 * success can never erase a failure another request recorded.
 */
const LUA_RELEASE = `
local ttl = redis.call('PTTL', KEYS[1])
if ttl == -2 then
  return { 0, -2 }
end
local current = redis.call('DECR', KEYS[1])
if current <= 0 then
  redis.call('DEL', KEYS[1])
  return { 0, -2 }
end
if ttl == -1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return { current, redis.call('PTTL', KEYS[1]) }
`;

const LUA_RELEASE_SHA = createHash("sha1").update(LUA_RELEASE).digest("hex");

export async function release(policy: RateLimitPolicy, subject: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const key = rateLimitKey(policy.id, subject);
  const windowMs = String(policy.windowSeconds * 1000);

  try {
    try {
      await redis.evalsha(LUA_RELEASE_SHA, 1, key, windowMs);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("NOSCRIPT")) throw error;
      await redis.eval(LUA_RELEASE, 1, key, windowMs);
    }
  } catch {
    /**
     * **Fail-safe by TTL.** If the release cannot be delivered — Redis went away,
     * or the process died between reserving and releasing — the reservation stays
     * counted. It is not a permanent lock: the key carries the policy's window as
     * its TTL from the first increment, so the worst case is that one legitimate
     * attempt is charged as though it had failed, and it expires on its own.
     * Failing in that direction is deliberate; the alternative is an attempt that
     * escapes counting whenever Redis is unreachable at exactly the wrong moment.
     */
  }
}

/**
 * Clears a subject's bucket entirely.
 *
 * Not used on any request path — a successful sign-in releases its own single
 * reservation rather than wiping the bucket, so it cannot erase failures other
 * requests recorded. Exported for deterministic test cleanup and for operational
 * recovery.
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
