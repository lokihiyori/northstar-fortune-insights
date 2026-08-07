import "dotenv/config";
import Redis from "ioredis";

/**
 * Rate-limit state cleanup for the end-to-end suite.
 *
 * The suite drives the *real* limiter — nothing is disabled and no test-only
 * policy is substituted, so a run genuinely proves the production limits work.
 * The consequence is that state survives the run, and the seeded development
 * account is the one subject that is not unique per run: the wrong-password
 * test charges it one failure every time. Five runs inside the fifteen-minute
 * window would lock it out and break the next run for reasons that have nothing
 * to do with the code under test.
 *
 * Clearing the rate-limit keyspace afterwards keeps every run independent. Only
 * keys under the rate-limit prefix are touched — the retrieval cache and its
 * generation counter are left alone.
 */
const RATE_LIMIT_PREFIX = "northstar:rl:v1";

export async function clearRateLimitKeys(): Promise<number> {
  const url = process.env["REDIS_URL"];
  if (!url) return 0;

  const redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });

  try {
    await redis.connect();
    const keys = await redis.keys(`${RATE_LIMIT_PREFIX}:*`);
    if (keys.length > 0) await redis.del(...keys);

    const remaining = await redis.keys(`${RATE_LIMIT_PREFIX}:*`);
    if (remaining.length > 0) {
      throw new Error(`rate-limit cleanup left ${String(remaining.length)} key(s) behind`);
    }

    return keys.length;
  } catch (error) {
    // Redis is optional (ADR 0004). If it is not running, there is nothing to
    // clean and the suite should not fail on the way out.
    if (error instanceof Error && error.message.includes("cleanup left")) throw error;
    return 0;
  } finally {
    redis.disconnect();
  }
}
