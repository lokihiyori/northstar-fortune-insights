import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithActionContext, runWithRequestContext } from "@/lib/observability/context";
import { logFailure, logger } from "@/lib/observability/logger";
import { errorCategoryForCode, ERROR_CATEGORIES, LOG_EVENTS } from "@/lib/observability/events";

/**
 * The logger, asserted through what actually reaches stdout.
 *
 * Every test captures the real console call rather than an injected sink, so
 * what is verified is the bytes a collector would receive.
 */

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  vi.stubEnv("LOG_LEVEL", "debug");
  // Assert the production shape by default: one JSON object per line is what a
  // collector consumes, and it is the format whose contract matters. The
  // development format has its own test below.
  vi.stubEnv("NODE_ENV", "production");
  for (const method of ["info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function lastRecord(): Record<string, unknown> {
  const line = lines.at(-1);
  expect(line, "a log line must have been written").toBeDefined();
  // Development format is `LEVEL event {json}`; production is bare JSON.
  const start = line!.indexOf("{");
  return JSON.parse(line!.slice(start)) as Record<string, unknown>;
}

describe("record shape", () => {
  it("carries the stable frame on every line", () => {
    logger.info("startup.env_validated", { nodeEnv: "test" });

    const record = lastRecord();
    expect(record["timestamp"]).toEqual(expect.any(String));
    expect(record["level"]).toBe("info");
    expect(record["event"]).toBe("startup.env_validated");
    expect(new Date(record["timestamp"] as string).toString()).not.toBe("Invalid Date");
  });

  it("emits one JSON object per line in production", () => {
    logger.warn("ratelimit.refused", { policyId: "auth_identifier" });

    const line = lines.at(-1)!;
    expect(() => JSON.parse(line) as unknown).not.toThrow();
    expect(line).not.toContain("\n");
  });

  it("emits a readable line in development instead of raw JSON", () => {
    // A developer reading a terminal is a different consumer from a collector.
    vi.stubEnv("NODE_ENV", "development");
    logger.warn("ratelimit.refused", { policyId: "auth_identifier" });

    const line = lines.at(-1)!;
    expect(line.startsWith("WARN ratelimit.refused")).toBe(true);
    expect(line).toContain("auth_identifier");
  });

  it("has no request frame outside a request", () => {
    // Startup logs are not HTTP requests and must not pretend to be.
    logger.info("startup.cache_ready", {});

    const record = lastRecord();
    expect(record["requestId"]).toBeUndefined();
    expect(record["route"]).toBeUndefined();
  });
});

describe("request correlation", () => {
  it("stamps the request frame from the surrounding context", () => {
    runWithRequestContext({ requestId: "req-abcdef12", route: "/api/v1/me", method: "GET" }, () => {
      logger.info("http.request_completed", { status: 200, durationMs: 5 });
    });

    const record = lastRecord();
    expect(record["requestId"]).toBe("req-abcdef12");
    expect(record["route"]).toBe("/api/v1/me");
    expect(record["method"]).toBe("GET");
    expect(record["status"]).toBe(200);
  });

  it("marks a Server Action so it is not mistaken for an HTTP request", () => {
    runWithActionContext("auth.signInAction", () => {
      logger.warn("auth.sign_in_refused", { reason: "invalid_credentials" });
    });

    const record = lastRecord();
    expect(record["method"]).toBe("ACTION");
    expect(record["route"]).toBe("auth.signInAction");
    expect(record["requestId"]).toEqual(expect.any(String));
  });

  it("gives concurrent contexts their own ids", async () => {
    // The reason for AsyncLocalStorage rather than a module variable: a shared
    // variable would stamp one request's id onto another's log line.
    await Promise.all([
      runWithRequestContext({ requestId: "req-aaaaaaaa", route: "/a", method: "GET" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        logger.info("http.request_completed", { status: 200 });
      }),
      runWithRequestContext({ requestId: "req-bbbbbbbb", route: "/b", method: "GET" }, async () => {
        logger.info("http.request_completed", { status: 201 });
      }),
    ]);

    const ids = lines.map(
      (line) => JSON.parse(line.slice(line.indexOf("{"))) as { requestId: string },
    );
    expect(ids.map((record) => record.requestId).sort()).toEqual(["req-aaaaaaaa", "req-bbbbbbbb"]);
  });
});

describe("field allow-listing", () => {
  it("drops secrets and private content passed by a caller", () => {
    runWithRequestContext({ requestId: "req-abcdef12", route: "/x", method: "POST" }, () => {
      logger.info("guidance.accepted", {
        question: "Should I retrain as a paramedic in Nova Scotia?",
        email: "someone.private@example.com",
        password: "e2e-test-passphrase",
        authorization: "Bearer abc.def",
        cookie: "authjs.session-token=xyz",
        DATABASE_URL: "postgresql://user:pw@host/db",
        generationId: "gen_1",
        topic: "CAREER",
      });
    });

    const line = lines.at(-1)!;
    for (const leak of [
      "paramedic",
      "someone.private@example.com",
      "e2e-test-passphrase",
      "Bearer",
      "authjs.session-token",
      "postgresql://",
    ]) {
      expect(line, leak).not.toContain(leak);
    }

    const record = lastRecord();
    expect(record["generationId"]).toBe("gen_1");
    expect(record["topic"]).toBe("CAREER");
  });

  it("refuses to let a caller forge the frame", () => {
    runWithRequestContext({ requestId: "req-real0001", route: "/real", method: "GET" }, () => {
      logger.warn("http.request_completed", {
        requestId: "req-forged001",
        route: "/forged",
        method: "DELETE",
        level: "debug",
        event: "startup.env_validated",
      });
    });

    const record = lastRecord();
    expect(record["requestId"]).toBe("req-real0001");
    expect(record["route"]).toBe("/real");
    expect(record["method"]).toBe("GET");
    expect(record["level"]).toBe("warn");
    expect(record["event"]).toBe("http.request_completed");
  });

  it("never serializes an object a caller passes", () => {
    logger.info("guidance.accepted", {
      user: { id: "u1", email: "someone@example.com" },
    });

    expect(lines.at(-1)).not.toContain("someone@example.com");
  });
});

describe("levels", () => {
  it("routes each level to the matching console channel", () => {
    const error = vi.mocked(console.error);
    const warn = vi.mocked(console.warn);
    const info = vi.mocked(console.info);

    logger.error("http.request_failed", {});
    logger.warn("ratelimit.refused", {});
    logger.info("guidance.accepted", {});

    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("suppresses records below the configured level", () => {
    vi.stubEnv("LOG_LEVEL", "error");

    logger.info("guidance.accepted", {});
    logger.warn("ratelimit.refused", {});
    expect(lines).toHaveLength(0);

    logger.error("http.request_failed", {});
    expect(lines).toHaveLength(1);
  });
});

describe("logFailure", () => {
  it("always stamps an error category", () => {
    logFailure("guidance.failed", "validation", { generationId: "gen_1" });

    const record = lastRecord();
    expect(record["level"]).toBe("error");
    expect(record["errorCategory"]).toBe("validation");
    expect(record["generationId"]).toBe("gen_1");
  });
});

describe("event and category catalogues", () => {
  it("has unique event names", () => {
    expect(new Set(LOG_EVENTS).size).toBe(LOG_EVENTS.length);
  });

  it("maps every API error code to a category", () => {
    const mapping = {
      VALIDATION_FAILED: "validation",
      UNAUTHENTICATED: "authentication",
      FORBIDDEN: "authorization",
      NOT_FOUND: "not_found",
      CONFLICT: "conflict",
      RATE_LIMITED: "rate_limited",
      SERVICE_UNAVAILABLE: "dependency_unavailable",
      INTERNAL: "internal",
    } as const;

    for (const [code, category] of Object.entries(mapping)) {
      expect(errorCategoryForCode(code), code).toBe(category);
    }
  });

  it("falls back to internal for an unknown code", () => {
    expect(errorCategoryForCode("SOMETHING_NEW")).toBe("internal");
    expect(ERROR_CATEGORIES).toContain("internal");
  });
});
