import "server-only";

import { prisma } from "@/lib/db/prisma";
import { getRedis } from "@/lib/redis/client";

/**
 * Readiness probes.
 *
 * Readiness answers "can this instance serve real traffic?", which is a
 * different question from liveness ("is this process alive?"). Conflating them
 * is a classic outage amplifier: a platform that restarts on a failed readiness
 * check will kill every healthy instance the moment a shared database blips.
 *
 * **Redis is required.** It was optional through Phase 8A, when it held only
 * cache. Phase 8B made rate limiting fail-closed for credential authentication
 * and generation, so an instance without Redis cannot sign anybody in. Reporting
 * it ready would be false.
 *
 * Every probe is bounded. An unbounded check turns a slow dependency into a
 * hanging health endpoint, and then into a load balancer that cannot tell
 * whether the instance is alive at all.
 */

export type DependencyState = "ok" | "unavailable";

export type ReadinessReport = {
  status: "ready" | "not_ready";
  checks: {
    database: DependencyState;
    cache: DependencyState;
  };
};

const DATABASE_TIMEOUT_MS = 1_500;
const CACHE_TIMEOUT_MS = 1_000;

/**
 * Resolves to `unavailable` rather than rejecting, so one dependency can never
 * mask another: both probes always run and both are reported.
 */
async function bounded(check: Promise<unknown>, timeoutMs: number): Promise<DependencyState> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<DependencyState>((resolve) => {
    timer = setTimeout(() => {
      resolve("unavailable");
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      check.then<DependencyState>(() => "ok").catch<DependencyState>(() => "unavailable"),
      timeout,
    ]);
    return result;
  } finally {
    // Without this the timer keeps the event loop alive for its full duration
    // on every probe, which at probe frequency is a real leak.
    if (timer) clearTimeout(timer);
  }
}

/**
 * The cheapest possible round trip that proves the connection works.
 *
 * `SELECT 1` touches no application table, takes no lock, and writes nothing —
 * a readiness probe must never mutate data, and this one runs as often as the
 * platform decides to call it.
 */
async function checkDatabase(): Promise<DependencyState> {
  return bounded(prisma.$queryRaw`SELECT 1`, DATABASE_TIMEOUT_MS);
}

/**
 * `PING` for the same reason. An absent `REDIS_URL` is reported as unavailable
 * rather than skipped: a deployment with no cache configured is not ready to
 * authenticate anyone, and silently passing would hide a misconfiguration.
 */
async function checkCache(): Promise<DependencyState> {
  const redis = getRedis();
  if (!redis) return "unavailable";
  return bounded(redis.ping(), CACHE_TIMEOUT_MS);
}

export async function checkReadiness(): Promise<ReadinessReport> {
  const [database, cache] = await Promise.all([checkDatabase(), checkCache()]);

  return {
    status: database === "ok" && cache === "ok" ? "ready" : "not_ready",
    checks: { database, cache },
  };
}

/**
 * Maps a report to its HTTP status.
 *
 * 503 rather than 500: the instance is working correctly and is reporting,
 * accurately, that it cannot serve yet. That distinction is what a load balancer
 * acts on.
 */
export function readinessStatusCode(report: ReadinessReport): number {
  return report.status === "ready" ? 200 : 503;
}
