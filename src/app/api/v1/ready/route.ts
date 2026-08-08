import { NextResponse } from "next/server";
import { withApiLogging } from "@/lib/observability/handler";
import { logger } from "@/lib/observability/logger";
import { checkReadiness, readinessStatusCode } from "@/lib/observability/readiness";

// Must reflect this instant, never a cached render.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Readiness (Phase 8C).
 *
 * Distinct from `/api/v1/health`, which is liveness and never touches a
 * dependency. This endpoint answers whether the instance can serve real traffic:
 * 200 only when PostgreSQL *and* Redis both respond, 503 otherwise.
 *
 * Deliberately unauthenticated and deliberately not rate limited. A platform
 * probe has no session, and gating readiness behind the rate limiter would make
 * it depend on the very dependency it exists to report on — a Redis outage would
 * then make readiness fail for the wrong reason and say nothing useful.
 *
 * The body names dependencies in the abstract (`database`, `cache`) and their
 * state as `ok` or `unavailable`. No host, port, username, database name, driver
 * message, or stack trace ever appears: this endpoint is reachable by anyone.
 */
export const GET = withApiLogging(
  "/api/v1/ready",
  async () => {
    const report = await checkReadiness();
    const status = readinessStatusCode(report);

    // Logged here rather than by the wrapper, because the useful signal is
    // which dependency failed — and success logging is off for probe traffic.
    if (report.status === "not_ready") {
      logger.warn("readiness.checked", {
        readyStatus: report.status,
        database: report.checks.database,
        cache: report.checks.cache,
      });
    }

    return NextResponse.json({ data: report }, { status });
  },
  { logSuccess: false },
);
