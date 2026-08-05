import "server-only";

import Redis from "ioredis";

/**
 * Redis access, deliberately fail-open.
 *
 * ADR 0004: PostgreSQL is the source of truth and Redis holds only data that
 * may be lost without correctness consequences. Every read path must therefore
 * work when Redis is down — a cache miss is a slower correct answer, never an
 * error. Nothing in this module throws to its caller.
 *
 * Redis is also optional: with no `REDIS_URL` the app runs uncached rather than
 * refusing to start.
 */
const globalForRedis = globalThis as unknown as { redis?: Redis | null };

function create(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  const client = new Redis(url, {
    // Fail fast instead of queueing commands behind a dead connection, which
    // would turn a Redis outage into request latency.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });

  // An unhandled 'error' event would crash the process. Redis being
  // unreachable is a degraded mode, not a fatal condition.
  client.on("error", (error: Error) => {
    console.warn(`Redis unavailable (continuing without cache): ${error.message}`);
  });

  return client;
}

export function getRedis(): Redis | null {
  if (globalForRedis.redis === undefined) {
    globalForRedis.redis = create();
  }
  return globalForRedis.redis;
}

/** Returns null on any failure, including Redis being absent or unreachable. */
export async function cacheGet(key: string): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

/** Every key gets a TTL — ADR 0004 forbids an unbounded keyspace. */
export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(key, value, "EX", ttlSeconds);
  } catch {
    // Losing a cache write is not worth failing a request over.
  }
}

export async function cacheIncrement(key: string): Promise<number | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    return await redis.incr(key);
  } catch {
    return null;
  }
}
