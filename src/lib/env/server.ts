import "server-only";

import { logger } from "@/lib/observability/logger";
import { configuredProviders, parseServerEnv, type ServerEnv } from "./schema";

/**
 * Server-side environment access.
 *
 * `assertServerEnv()` is called from `src/instrumentation.ts`, which Next runs
 * once per server instance *before* the server accepts requests — so a
 * misconfigured deployment fails at startup with a named variable rather than
 * at 3am inside a request handler.
 */
let cached: ServerEnv | undefined;

/** True while `next build` is running, where runtime secrets are not required. */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env, { isBuildPhase: isBuildPhase() });
  return cached;
}

/**
 * Validates and reports what is configured. Throws `EnvValidationError` — whose
 * message names variables and never prints values — so the process exits with a
 * usable diagnostic.
 */
export function assertServerEnv(): ServerEnv {
  const env = serverEnv();

  const providers = configuredProviders(env);

  /**
   * Provider *names* only. Whether a provider is switched on is operationally
   * useful; its credentials are not and must never reach a log.
   *
   * A startup event, not an HTTP request event: there is no request context at
   * boot, so this line carries no `requestId` by design.
   */
  logger.info("startup.env_validated", {
    nodeEnv: env.NODE_ENV,
    providers: providers.length > 0 ? providers.join(",") : "none",
    guidanceProvider: providers.includes("openai") ? "openai" : "deterministic",
    billingEnabled: providers.includes("stripe"),
  });

  return env;
}

/** Test-only: clears the memoized value so a new environment can be parsed. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
