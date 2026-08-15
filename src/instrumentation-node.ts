/**
 * Node-only startup work, reached exclusively through the conditional dynamic
 * import in `./instrumentation.ts`.
 *
 * Everything here assumes the Node.js runtime: the full environment, the Node
 * logger, an ioredis client, and `process.exit`. None of it is safe to analyse
 * against the Edge runtime, which is precisely why it is a separate module —
 * the shared entry stays runtime-agnostic and this file is only ever pulled in
 * when `NEXT_RUNTIME === "nodejs"`.
 *
 * Phase 8A wires environment validation here so a misconfigured deployment
 * fails immediately, naming the offending variable and never printing values
 * (ADR 0007).
 */
export async function registerNodeInstrumentation(): Promise<void> {
  // Imported dynamically so this module stays cheap to load and the collaborator
  // graph is resolved at call time, which is also what makes it stubbable.
  const { assertServerEnv } = await import("./lib/env/server");

  try {
    assertServerEnv();
  } catch (error) {
    const issues =
      error instanceof Error && "issues" in error && Array.isArray(error.issues)
        ? (error.issues as string[])
        : [error instanceof Error ? error.message : String(error)];

    // Two audiences, deliberately. The human-readable block is what an operator
    // reads in a terminal or a container's first log page; the structured event
    // is what a collector counts. Both carry variable names and rules only —
    // never the offending values.
    console.error("[env] Startup validation failed:");
    for (const issue of issues) console.error(`  - ${issue}`);

    const { logger } = await import("./lib/observability/logger");
    logger.error("startup.env_invalid", { issueCount: issues.length });

    const isProductionRuntime =
      process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";

    if (isProductionRuntime) {
      // Observed behaviour without this: Next catches the rejection, refuses
      // every request, but leaves the process running. Traffic is safely
      // rejected, yet a supervisor sees a live process rather than a failed
      // one and never restarts or alerts. Exiting makes the failure legible to
      // systemd, Docker, and orchestrators.
      console.error("[env] Refusing to start. Fix the variables above and redeploy.");
      process.exit(1);
    }

    // Development and test: rethrow so the error surfaces in the terminal
    // without killing a watch process the developer is iterating in.
    throw error;
  }

  await openRedisConnection();
}

/**
 * Opens the Redis connection at boot rather than on the first request.
 *
 * The client sets `enableOfflineQueue: false`, so a command issued while the
 * socket is still connecting is rejected immediately rather than queued. That
 * is right for a cache — a miss is free — but Phase 8B made rate limiting
 * depend on the same client, and there fail-closed endpoints would answer 503
 * for the whole connect window. Connecting here moves that window to startup,
 * before any traffic arrives.
 *
 * Deliberately never throws and never blocks startup for long: Redis is
 * optional (ADR 0004), and an outage must not stop the app from serving.
 */
async function openRedisConnection(): Promise<void> {
  try {
    const { getRedis } = await import("./lib/redis/client");
    const { logger } = await import("./lib/observability/logger");

    const redis = getRedis();
    if (!redis) {
      logger.warn("startup.cache_unavailable", { reason: "not_configured" });
      return;
    }
    if (redis.status === "ready") {
      logger.info("startup.cache_ready", {});
      return;
    }

    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        redis.off("ready", done);
        resolve();
      };
      const timer = setTimeout(done, 2_000);
      redis.once("ready", done);
    });

    // Read into a widened local: TypeScript narrowed `status` at the early
    // return above and cannot see that awaiting may have changed it.
    const status: string = redis.status;
    if (status === "ready") logger.info("startup.cache_ready", {});
    else logger.warn("startup.cache_unavailable", { reason: "connect_timeout" });
  } catch {
    // Already reported by the client's own error handler; startup continues.
  }
}
