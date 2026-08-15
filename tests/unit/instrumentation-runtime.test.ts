// @vitest-environment node
import { execFile } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The runtime split in `src/instrumentation.ts`.
 *
 * Next calls `register()` in every runtime and compiles the shared entry for
 * Edge as well as Node. Anything Node-only that is statically visible in that
 * entry is analysed against the Edge runtime even when a `NEXT_RUNTIME` guard
 * means it can never run there — which is what `process.exit` did. The Node
 * work now lives in `src/instrumentation-node.ts`, reached only through a
 * conditional dynamic import.
 *
 * These tests pin both halves: Edge must not reach the Node module at all, and
 * the Node module must still validate, still warm Redis, and still end a
 * misconfigured production process.
 *
 * The logger is **not** mocked — its real output is read back off `console`, so
 * "validation logged `startup.env_validated`" is proved by the line the server
 * would actually emit.
 */

const VALID_DB = "postgresql://northstar:northstar@127.0.0.1:55432/northstar";

const getRedis = vi.fn();
vi.mock("@/lib/redis/client", () => ({ getRedis: () => getRedis() as unknown }));

/** A fake ioredis client. Real Redis is covered by the integration suite. */
function fakeRedis(status: string) {
  return { status, on: vi.fn(), off: vi.fn(), once: vi.fn() };
}

let logged: string[] = [];

/** Event names the real logger wrote, in order. */
function loggedEvents(): string[] {
  return logged
    .map((line) => /(?:^|\s)(startup\.[a-z_]+)/.exec(line)?.[1])
    .filter((event): event is string => Boolean(event));
}

beforeEach(async () => {
  vi.clearAllMocks();

  /*
   * Reset the registry first, then clear the environment cache on the instance
   * every test will actually receive. Resetting a statically imported copy
   * would clear a module the dynamic imports below no longer resolve to, and
   * a stale memoized environment would silently invalidate these assertions.
   */
  vi.resetModules();
  const { resetServerEnvCache } = await import("@/lib/env/server");
  resetServerEnvCache();

  logged = [];
  const capture = (line: unknown) => {
    logged.push(String(line));
  };
  vi.spyOn(console, "info").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runtime split", () => {
  it("does not reach the Node startup module on the Edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    const nodeStartup = vi.fn(async () => {
      /* must never run */
    });
    vi.resetModules();
    vi.doMock("@/instrumentation-node", () => ({ registerNodeInstrumentation: nodeStartup }));

    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();

    // The whole point of the split: on Edge the Node module is never imported,
    // so its environment access, logger, Redis client and exit path are never
    // loaded or executed.
    expect(nodeStartup).not.toHaveBeenCalled();
    expect(getRedis).not.toHaveBeenCalled();
    expect(loggedEvents()).toEqual([]);

    vi.doUnmock("@/instrumentation-node");
  });

  it("runs the Node startup module exactly once on the Node runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    const nodeStartup = vi.fn(async () => {
      /* stubbed; its behaviour is covered below */
    });
    vi.resetModules();
    vi.doMock("@/instrumentation-node", () => ({ registerNodeInstrumentation: nodeStartup }));

    const { register } = await import("@/instrumentation");
    await register();

    expect(nodeStartup).toHaveBeenCalledTimes(1);

    vi.doUnmock("@/instrumentation-node");
    vi.resetModules();
  });
});

describe("Node startup", () => {
  it("validates the environment and warms Redis when configuration is valid", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", VALID_DB);
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:56379");
    getRedis.mockReturnValue(fakeRedis("ready"));

    const { registerNodeInstrumentation } = await import("@/instrumentation-node");
    await registerNodeInstrumentation();

    // `startup.env_validated` is emitted by the real `assertServerEnv`, so its
    // presence proves validation ran — and warm-up followed it, in that order.
    expect(loggedEvents()).toEqual(["startup.env_validated", "startup.cache_ready"]);
    expect(getRedis).toHaveBeenCalledTimes(1);
  });

  it("keeps Redis warm-up fail-open when the cache is not configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", VALID_DB);
    getRedis.mockReturnValue(null);

    const { registerNodeInstrumentation } = await import("@/instrumentation-node");

    // Startup completes rather than throwing: Redis is optional (ADR 0004).
    await expect(registerNodeInstrumentation()).resolves.toBeUndefined();
    expect(loggedEvents()).toEqual(["startup.env_validated", "startup.cache_unavailable"]);
  });

  it("rethrows in development instead of ending the process", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "");

    // Not the proof that production exits — that is the child process below.
    // This asserts the opposite property: a developer's watch process survives.
    const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
      throw new Error("process.exit must not be called outside production");
    }) as never);

    const { registerNodeInstrumentation } = await import("@/instrumentation-node");

    await expect(registerNodeInstrumentation()).rejects.toThrow();
    expect(exit).not.toHaveBeenCalled();
    expect(loggedEvents()).toContain("startup.env_invalid");
    // Redis warm-up is never reached when validation fails.
    expect(getRedis).not.toHaveBeenCalled();
  });
});

describe("production startup with invalid configuration", () => {
  /**
   * A real child process, because the property under test is the process
   * outcome. Stubbing `process.exit` would prove the call was made, not that a
   * misconfigured production process actually dies — which is the contract in
   * ADR 0007.
   *
   * **Scope.** The harness invokes `registerNodeInstrumentation()` directly. It
   * is not a Next server and opens no HTTP listener, so it proves that startup
   * instrumentation did not complete and that the process exited non-zero — not
   * that a real server never binds a port. Measured separately against
   * `next start`: Next prints its own `Ready` line and can briefly bind the
   * listener before instrumentation failure terminates the process, identically
   * before and after this change. The operational conclusion is unaffected —
   * invalid production configuration terminates the process non-zero and no
   * misconfigured server survives — but deployment readiness must be taken from
   * `/api/v1/ready`, never from stdout or a transient socket.
   */
  it("exits non-zero, reports only variable names and rules, and never completes Node startup instrumentation", async () => {
    const harness = path.join(process.cwd(), "tests/unit/fixtures/production-startup-harness.ts");

    // Deliberately too short for the production rule, and deliberately
    // memorable so the assertion below can prove it never reached the output.
    const suppliedSecret = "ns-invalid-secret";

    const result = await new Promise<{ code: number; output: string; pid: number | undefined }>(
      (resolve, reject) => {
        const child = execFile(
          "pnpm",
          ["exec", "tsx", `"${harness}"`],
          {
            cwd: process.cwd(),
            shell: true,
            timeout: 60_000,
            env: {
              ...process.env,
              // `server-only` resolves to its empty module under this condition,
              // exactly as it does inside a Next server build. Without it the
              // marker package throws and the exit code would prove nothing.
              NODE_OPTIONS: "--conditions=react-server",
              NODE_ENV: "production",
              NEXT_PHASE: "",
              DATABASE_URL: VALID_DB,
              AUTH_SECRET: suppliedSecret,
              NEXT_PUBLIC_APP_URL: "http://localhost:3000",
            },
          },
          (error, stdout, stderr) => {
            if (error && (error as { killed?: boolean }).killed) {
              reject(new Error("harness timed out"));
              return;
            }
            const code =
              error && typeof (error as { code?: unknown }).code === "number"
                ? (error as { code: number }).code
                : error
                  ? 1
                  : 0;
            resolve({ code, output: `${stdout}\n${stderr}`, pid: child.pid });
          },
        );
        child.on("error", reject);
      },
    );

    // 1. Non-zero, and specifically the exit path — the harness reports the
    //    development rethrow as 9, so this cannot pass by the wrong route.
    expect(result.code).toBe(1);

    // 2. `registerNodeInstrumentation()` never returned successfully; the
    //    harness completion marker must therefore be absent.
    expect(result.output).not.toContain("HARNESS_REACHED_READY");

    // 3. Sanitized diagnostics: variables named, rules stated.
    expect(result.output).toContain("AUTH_SECRET");
    expect(result.output).toContain("NEXT_PUBLIC_APP_URL");
    expect(result.output).toContain("[env] Refusing to start");

    // 4. No supplied value reached the output.
    expect(result.output).not.toContain(suppliedSecret);

    // 5. The child was reaped — `execFile`'s callback only fires on exit, so a
    //    resolved promise is itself the proof that nothing was left running.
    expect(result.pid).toBeTypeOf("number");
  }, 90_000);
});
