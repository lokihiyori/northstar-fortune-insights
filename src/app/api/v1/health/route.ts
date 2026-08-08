import { NextResponse } from "next/server";
import { withApiLogging } from "@/lib/observability/handler";

// Liveness must reflect the current process, never a cached render.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Liveness (Phase 8C).
 *
 * Answers one question: is this process alive and able to serve HTTP? It
 * therefore **must not touch PostgreSQL or Redis**. A liveness check that
 * depends on a database restarts every instance when that database blips, which
 * turns a dependency incident into a total outage. Readiness is the endpoint
 * that reports dependencies — see `/api/v1/ready`.
 *
 * The payload stays minimal and non-sensitive: no versions of dependencies, no
 * hostnames, no configuration. It is reachable by anyone.
 */
export const GET = withApiLogging(
  "/api/v1/health",
  () =>
    NextResponse.json({
      data: {
        status: "ok",
        service: "northstar",
        phase: 8,
        timestamp: new Date().toISOString(),
      },
    }),
  // Probe traffic. Failures still log; successes would bury real signal.
  { logSuccess: false },
);
