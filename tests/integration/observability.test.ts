// @vitest-environment node
import "dotenv/config";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Redis from "ioredis";

import { runWithRequestContext } from "@/lib/observability/context";
import { logger } from "@/lib/observability/logger";
import { apiError } from "@/lib/api/response";
import { checkReadiness, readinessStatusCode } from "@/lib/observability/readiness";

/**
 * Observability against the real dependencies.
 *
 * Readiness is exercised against the actual PostgreSQL and Redis this project
 * runs on, including genuine outages produced by pointing the client at a
 * closed port. Nothing about the dependency probes is mocked.
 */

let lines: string[] = [];

function captureConsole(): void {
  lines = [];
  for (const method of ["info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
  }
}

function records(): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line.slice(line.indexOf("{"))) as Record<string, unknown>);
}

/** Both clients are cached on `globalThis`, so resetting modules is not enough. */
function forgetCachedRedisClient(): void {
  const cache = globalThis as unknown as { redis?: Redis | null };
  cache.redis?.disconnect();
  delete cache.redis;
}

function forgetCachedPrismaClient(): void {
  const cache = globalThis as unknown as { prisma?: { $disconnect: () => Promise<void> } };
  void cache.prisma?.$disconnect();
  delete cache.prisma;
}

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

beforeAll(async () => {
  if (!process.env["REDIS_URL"]) {
    throw new Error("REDIS_URL is not set. Start the stack with `pnpm db:up`.");
  }
  await restoreHealthyRedisClient();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(async () => {
  const { prisma } = await import("@/lib/db/prisma");
  await prisma.$disconnect();
  forgetCachedRedisClient();
});

describe("readiness against real dependencies", () => {
  it("reports ready when PostgreSQL and Redis are both healthy", async () => {
    const report = await checkReadiness();

    expect(report).toEqual({ status: "ready", checks: { database: "ok", cache: "ok" } });
    expect(readinessStatusCode(report)).toBe(200);
  });

  it("reports 503 when Redis is unavailable", async () => {
    vi.resetModules();
    forgetCachedRedisClient();
    // A port with nothing listening: a real connection failure, not a stub.
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6393");

    try {
      const offline = await import("@/lib/observability/readiness");
      const report = await offline.checkReadiness();

      expect(report.checks.cache).toBe("unavailable");
      // PostgreSQL is untouched, so the report must still say it is fine.
      expect(report.checks.database).toBe("ok");
      expect(offline.readinessStatusCode(report)).toBe(503);

      const client = await import("@/lib/redis/client");
      client.getRedis()?.disconnect();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      await restoreHealthyRedisClient();
    }
  }, 20_000);

  it("reports 503 when PostgreSQL is unavailable", async () => {
    vi.resetModules();
    forgetCachedPrismaClient();
    // A port with nothing listening, so the failure is a real connection error.
    vi.stubEnv("DATABASE_URL", "postgresql://northstar:northstar@127.0.0.1:55499/northstar");

    try {
      const offline = await import("@/lib/observability/readiness");
      const report = await offline.checkReadiness();

      expect(report.checks.database).toBe("unavailable");
      expect(offline.readinessStatusCode(report)).toBe(503);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      forgetCachedPrismaClient();
    }
  }, 20_000);

  it("never exposes a host, port, credential, or driver message", async () => {
    vi.resetModules();
    forgetCachedPrismaClient();
    vi.stubEnv("DATABASE_URL", "postgresql://northstar:northstar@127.0.0.1:55499/northstar");

    try {
      const offline = await import("@/lib/observability/readiness");
      const serialized = JSON.stringify(await offline.checkReadiness());

      for (const leak of [
        "127.0.0.1",
        "55499",
        "55432",
        "northstar",
        "postgresql://",
        "ECONNREFUSED",
        "P1001",
      ]) {
        expect(serialized, leak).not.toContain(leak);
      }
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      forgetCachedPrismaClient();
    }
  }, 20_000);

  it("does not mutate application data", async () => {
    const { prisma } = await import("@/lib/db/prisma");

    const before = await prisma.user.count();
    await checkReadiness();
    await checkReadiness();
    const after = await prisma.user.count();

    expect(after).toBe(before);
  });
});

describe("request id correlation", () => {
  it("puts the same id in the error envelope and the log line", async () => {
    captureConsole();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "debug");

    const requestId = "req-integration01";
    let body: { error: { requestId: string } } | undefined;

    await runWithRequestContext({ requestId, route: "/api/v1/test", method: "GET" }, async () => {
      logger.warn("http.request_completed", { status: 422 });
      const response = apiError("VALIDATION_FAILED", "Check the submitted fields.");
      body = (await response.json()) as { error: { requestId: string } };
    });

    // The envelope carries the *request's* id, not a fresh one per error...
    expect(body?.error.requestId).toBe(requestId);
    // ...and the log line agrees, which is what makes a quoted id findable.
    expect(records().some((record) => record["requestId"] === requestId)).toBe(true);
  });

  it("gives two errors in one request the same id", async () => {
    let first: string | undefined;
    let second: string | undefined;

    await runWithRequestContext(
      { requestId: "req-integration02", route: "/api/v1/test", method: "POST" },
      async () => {
        first = ((await apiError("NOT_FOUND", "nope").json()) as { error: { requestId: string } })
          .error.requestId;
        second = ((await apiError("CONFLICT", "nope").json()) as { error: { requestId: string } })
          .error.requestId;
      },
    );

    expect(first).toBe("req-integration02");
    expect(second).toBe(first);
  });

  it("still produces an id outside a request context", async () => {
    const body = (await apiError("INTERNAL", "nope").json()) as { error: { requestId: string } };
    expect(body.error.requestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe("logging cannot break the caller", () => {
  it("survives a console that throws", () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    for (const method of ["info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation(() => {
        throw new Error("stdout is gone");
      });
    }

    // Not hypothetical: a closed stdout raises EPIPE on write, and an unhandled
    // one takes the process down. Losing a log line is a smaller problem than
    // losing the response it was describing.
    expect(() => {
      logger.info("guidance.accepted", { generationId: "gen_1" });
      logger.error("http.request_failed", { status: 500 });
    }).not.toThrow();
  });

  it("keeps monitoring failures away from the caller", async () => {
    const monitoring = await import("@/lib/observability/monitoring");

    monitoring.setMonitoringAdapter({
      name: "exploding",
      captureException: () => {
        throw new Error("vendor exploded");
      },
      captureMessage: () => {
        throw new Error("vendor exploded");
      },
    });

    try {
      expect(() => {
        monitoring.captureException(new Error("original"));
      }).not.toThrow();
    } finally {
      monitoring.resetMonitoringAdapter();
    }
  });
});
