import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Readiness mapping and bounded-timeout behaviour.
 *
 * PostgreSQL and Redis are replaced with controllable stubs so every
 * combination — including a dependency that never answers — can be exercised
 * deterministically. The real dependencies are covered in
 * tests/integration/observability.
 */

let databaseBehaviour: () => Promise<unknown> = () => Promise.resolve([{ "?column?": 1 }]);
let cacheBehaviour: (() => Promise<unknown>) | null = () => Promise.resolve("PONG");

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $queryRaw: () => databaseBehaviour(),
  },
}));

vi.mock("@/lib/redis/client", () => ({
  getRedis: () => (cacheBehaviour ? { ping: () => cacheBehaviour!() } : null),
}));

const { checkReadiness, readinessStatusCode } = await import("@/lib/observability/readiness");

afterEach(() => {
  databaseBehaviour = () => Promise.resolve([{ "?column?": 1 }]);
  cacheBehaviour = () => Promise.resolve("PONG");
  vi.useRealTimers();
});

describe("result mapping", () => {
  it("is ready only when both dependencies answer", async () => {
    const report = await checkReadiness();

    expect(report).toEqual({ status: "ready", checks: { database: "ok", cache: "ok" } });
    expect(readinessStatusCode(report)).toBe(200);
  });

  it("is not ready when PostgreSQL fails", async () => {
    databaseBehaviour = () => Promise.reject(new Error("connection refused"));

    const report = await checkReadiness();

    expect(report.status).toBe("not_ready");
    expect(report.checks.database).toBe("unavailable");
    expect(report.checks.cache).toBe("ok");
    expect(readinessStatusCode(report)).toBe(503);
  });

  it("is not ready when Redis fails", async () => {
    // Redis is required since Phase 8B made rate limiting fail-closed for
    // credential authentication: an instance without it cannot sign anyone in.
    cacheBehaviour = () => Promise.reject(new Error("connection refused"));

    const report = await checkReadiness();

    expect(report.status).toBe("not_ready");
    expect(report.checks.database).toBe("ok");
    expect(report.checks.cache).toBe("unavailable");
    expect(readinessStatusCode(report)).toBe(503);
  });

  it("is not ready when Redis is not configured at all", async () => {
    cacheBehaviour = null;

    const report = await checkReadiness();

    expect(report.checks.cache).toBe("unavailable");
    expect(report.status).toBe("not_ready");
  });

  it("reports both dependencies even when both are down", async () => {
    // One failure must not mask the other, or an operator fixes half a problem.
    databaseBehaviour = () => Promise.reject(new Error("down"));
    cacheBehaviour = () => Promise.reject(new Error("down"));

    const report = await checkReadiness();

    expect(report.checks).toEqual({ database: "unavailable", cache: "unavailable" });
  });
});

describe("bounded timeouts", () => {
  it("does not hang when a dependency never answers", async () => {
    // The failure this prevents: a health endpoint that stops responding, so a
    // load balancer cannot tell whether the instance is alive at all.
    databaseBehaviour = () => new Promise(() => undefined);

    const started = Date.now();
    const report = await checkReadiness();
    const elapsed = Date.now() - started;

    expect(report.checks.database).toBe("unavailable");
    expect(report.status).toBe("not_ready");
    // Well inside the 1.5s database bound, and nowhere near a request timeout.
    expect(elapsed).toBeLessThan(3_000);
  }, 10_000);

  it("runs both probes concurrently rather than in series", async () => {
    cacheBehaviour = () => new Promise(() => undefined);
    databaseBehaviour = () => new Promise(() => undefined);

    const started = Date.now();
    await checkReadiness();
    const elapsed = Date.now() - started;

    // Serial execution would take at least 1500 + 1000 ms.
    expect(elapsed).toBeLessThan(2_400);
  }, 10_000);

  it("treats a slow but eventually successful probe as unavailable", async () => {
    databaseBehaviour = () =>
      new Promise((resolve) =>
        setTimeout(() => {
          resolve([{ ok: 1 }]);
        }, 5_000),
      );

    const report = await checkReadiness();
    expect(report.checks.database).toBe("unavailable");
  }, 10_000);
});

describe("response safety", () => {
  it("exposes only abstract dependency names and states", async () => {
    databaseBehaviour = () =>
      Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:55432 for user northstar"));
    cacheBehaviour = () => Promise.reject(new Error("redis://127.0.0.1:56379 unreachable"));

    const serialized = JSON.stringify(await checkReadiness());

    // This endpoint is reachable by anyone, so nothing about the topology may
    // appear in it.
    for (const leak of ["127.0.0.1", "55432", "56379", "northstar", "ECONNREFUSED", "redis://"]) {
      expect(serialized, leak).not.toContain(leak);
    }

    expect(JSON.parse(serialized)).toEqual({
      status: "not_ready",
      checks: { database: "unavailable", cache: "unavailable" },
    });
  });

  it("uses only the two documented dependency states", async () => {
    const ready = await checkReadiness();
    cacheBehaviour = () => Promise.reject(new Error("down"));
    const notReady = await checkReadiness();

    for (const report of [ready, notReady]) {
      for (const state of Object.values(report.checks)) {
        expect(["ok", "unavailable"]).toContain(state);
      }
    }
  });
});
