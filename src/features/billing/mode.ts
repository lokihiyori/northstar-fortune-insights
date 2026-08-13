/**
 * Which Stripe mode this process is configured for.
 *
 * **Mode comes from the key, never from `NODE_ENV`.** Stripe decides test or
 * live from the credential presented, and this project deliberately runs
 * `NODE_ENV=production` against test keys during local verification. Deriving
 * mode from the environment would reject every legitimate object in exactly the
 * configuration used to verify the integration.
 *
 * Pure and dependency-free, so every branch is unit testable without a request,
 * a client, or a network call.
 */

export type StripeMode = "test" | "live";

/**
 * The four public key markers. These are format prefixes, not entropy — but
 * nothing here ever returns or logs them, only the derived word.
 */
const TEST_PREFIXES = ["sk_test_", "rk_test_"] as const;
const LIVE_PREFIXES = ["sk_live_", "rk_live_"] as const;

export class StripeModeError extends Error {
  override readonly name = "StripeModeError";
}

/**
 * Classifies a secret key.
 *
 * Anything unrecognised **throws** rather than defaulting. Guessing would mean
 * choosing between silently accepting live objects in a test deployment and
 * silently rejecting every object — both worse than refusing to start.
 *
 * The error names the variable and the rule, never the value, matching the
 * Phase 8A convention.
 */
export function stripeModeFromKey(secretKey: string | undefined): StripeMode {
  const key = secretKey ?? "";

  if (TEST_PREFIXES.some((prefix) => key.startsWith(prefix))) return "test";
  if (LIVE_PREFIXES.some((prefix) => key.startsWith(prefix))) return "live";

  throw new StripeModeError(
    "STRIPE_SECRET_KEY must begin with sk_test_, rk_test_, sk_live_, or rk_live_",
  );
}

/**
 * Cross-checks an explicit `STRIPE_MODE` against the key.
 *
 * `STRIPE_MODE` is a guard against a key being swapped underneath a deployment,
 * not a source of truth. When the two disagree the process refuses to continue,
 * naming both variables and neither value.
 */
export function resolveStripeMode(env: NodeJS.ProcessEnv = process.env): StripeMode {
  const derived = stripeModeFromKey(env["STRIPE_SECRET_KEY"]);
  const declared = env["STRIPE_MODE"];

  if (declared !== undefined && declared !== derived) {
    throw new StripeModeError(
      "STRIPE_MODE does not agree with the mode implied by STRIPE_SECRET_KEY",
    );
  }

  return derived;
}

/**
 * The `livemode` value every Stripe object and event must carry.
 *
 * Compared for equality against this constant, never inferred from
 * `NODE_ENV === "production"`. Equality in both directions is what makes mixing
 * impossible: a test process rejects live objects *and* a live process rejects
 * test objects.
 */
export function expectedLivemode(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveStripeMode(env) === "live";
}

/** True when an object's `livemode` matches this process's configured mode. */
export function livemodeMatches(
  objectLivemode: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return objectLivemode === expectedLivemode(env);
}
