import "server-only";

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
  // Names only. Whether a provider is on is operationally useful; its
  // credentials are not, and must never reach a log.
  console.info(
    `[env] validated for NODE_ENV=${env.NODE_ENV}. ` +
      `Optional providers enabled: ${providers.length > 0 ? providers.join(", ") : "none"}.`,
  );

  if (!providers.includes("openai")) {
    console.info("[env] No OPENAI_API_KEY — using the deterministic guidance provider.");
  }
  if (!providers.includes("stripe")) {
    console.info("[env] Stripe not configured — the upgrade path is disabled.");
  }

  return env;
}

/** Test-only: clears the memoized value so a new environment can be parsed. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
