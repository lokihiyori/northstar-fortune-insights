/**
 * Demo-mode configuration — the only place that reads the demo environment.
 *
 * Three rules shape this module:
 *
 *  1. **Demo status is derived on the server, never supplied by the client.**
 *     There is no `NEXT_PUBLIC_` demo flag and no demo field in the JWT that a
 *     browser could influence. Callers pass an authenticated email or user id;
 *     this module compares it against configuration the server owns.
 *
 *  2. **The email is the identity.** It is `@unique`, normalized to lowercase
 *     at both sign-up and sign-in (`features/auth/validation.ts`), and
 *     immutable — nothing in `src` updates `users.email`. That makes a schema
 *     column unnecessary: there is no `User.isDemo`, and no migration.
 *
 *  3. **The password never leaves the server.** It is read here, used by the
 *     sign-in Server Action and the reset command, and never returned, logged,
 *     serialized, or embedded in markup.
 *
 * Pure and dependency-free so every branch is unit testable without a request
 * or a database.
 */

/** Enabled only by the exact string `"true"`. Anything else is off. */
export function demoModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["DEMO_MODE_ENABLED"] === "true";
}

/**
 * The reserved demo address, normalized the same way the auth layer normalizes
 * a submitted address, or `null` when demo mode is off or unconfigured.
 */
export function demoAccountEmail(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!demoModeEnabled(env)) return null;
  return normalizeDemoEmail(env["DEMO_ACCOUNT_EMAIL"]);
}

/** Lowercased and trimmed — matches `features/auth/validation.ts`. */
export function normalizeDemoEmail(raw: string | undefined | null): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  return value.length > 0 ? value : null;
}

/**
 * The demo password, or `null`. Never send this anywhere but Auth.js.
 *
 * Returning `null` rather than throwing keeps a misconfigured deployment on the
 * "no usable demo action" path instead of surfacing a configuration error to a
 * visitor.
 */
export function demoAccountPassword(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!demoModeEnabled(env)) return null;
  const value = env["DEMO_ACCOUNT_PASSWORD"] ?? "";
  return value.length > 0 ? value : null;
}

/** True only when the flag, the email, and the password are all present. */
export function demoModeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return demoAccountEmail(env) !== null && demoAccountPassword(env) !== null;
}

/**
 * Is this address the reserved demo account?
 *
 * Compares normalized values so casing or stray whitespace cannot be used to
 * register a look-alike of the reserved address.
 */
export function isDemoEmail(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const configured = demoAccountEmail(env);
  if (configured === null) return false;

  const candidate = normalizeDemoEmail(email);
  return candidate !== null && candidate === configured;
}

/**
 * Is this address reserved against ordinary sign-up?
 *
 * Distinct from `isDemoEmail` on purpose: reservation holds whenever an address
 * is configured, **even when the flag is off**. Otherwise toggling demo mode on
 * later could collide with an account a stranger had already registered, and
 * the reset command would then be pointed at a real person's row.
 */
export function isReservedDemoEmail(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const configured = normalizeDemoEmail(env["DEMO_ACCOUNT_EMAIL"]);
  if (configured === null) return false;

  const candidate = normalizeDemoEmail(email);
  return candidate !== null && candidate === configured;
}

/** Production acknowledgement. Deliberately unset in this phase. */
export function demoAllowedInProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["DEMO_ALLOW_IN_PRODUCTION"] === "true";
}
