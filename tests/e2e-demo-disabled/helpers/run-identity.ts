import { RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";
import { demoRateLimitKeys } from "@/features/demo/redis-cleanup";

/**
 * What the demo-disabled run owns in Redis, in one place.
 *
 * The suite signs in once with a deliberately wrong password. That is a real
 * request against the real `AUTH_IDENTIFIER` policy, and because the policy
 * counts reservations, a definitive wrong-password result *commits* the unit —
 * so the bucket survives the run with the full 15-minute TTL. Only this run
 * created it, and only this run should remove it.
 *
 * The identifier lives here rather than in the spec so the test that creates the
 * key and the teardown that deletes it cannot drift apart.
 */
export const DEMO_DISABLED_PROBE_EMAIL = "nobody-demo-disabled@northstar.test";

/**
 * Carries the run's ephemeral `AUTH_SECRET` from the Playwright config to the
 * teardown, **in this process only**.
 *
 * The digest that names the bucket is an HMAC under the secret the disabled
 * server was started with, so the teardown cannot compute the key without it.
 * A dedicated variable rather than `AUTH_SECRET` on purpose: writing the run
 * secret to `AUTH_SECRET` here would shadow the developer's persistent value
 * for the rest of the process. Nothing writes it to disk, logs it, or commits
 * it, and the config strips it back out of the server's own environment.
 */
export const DEMO_DISABLED_RUN_SECRET_ENV = "NORTHSTAR_DEMO_DISABLED_RUN_SECRET";

/** Marks the failures this suite must never swallow. See the teardown's catch. */
export const TEARDOWN_FATAL_PREFIX = "demo-disabled teardown:";

/**
 * The one exact key this run owns.
 *
 * Composed by the production helper — the same normalization, the same keyed
 * digest, the same policy table, and the same prefix the limiter writes. No
 * pattern, no `SCAN`, no second copy of the cryptography here. The prefix comes
 * from `features/demo/redis-cleanup`, which is the non-`server-only` home of it
 * and is already pinned against the limiter by an existing test;
 * `tests/unit/demo-disabled-teardown-key.test.ts` pins this composition against
 * the limiter's own `rateLimitKey` as well.
 *
 * `demoRateLimitKeys` returns a key per identifier-subject policy for this
 * address. Only the `AUTH_IDENTIFIER` one is selected: it is the single bucket
 * the failed sign-in creates, and narrowing here keeps the teardown from
 * deleting a bucket the suite never wrote.
 *
 * **Fails closed on a missing secret.** `digestIdentifier` falls back to a known
 * development salt when handed nothing, which is right for an app running
 * without `AUTH_SECRET` and wrong here: the disabled server is *always* started
 * with a freshly generated one. If the carrier variable ever went missing — a
 * Playwright lifecycle change, a config edit — the fallback would quietly derive
 * a *different* key, find it absent, report `observed=0 removed=0 remaining=0`,
 * and leave the real bucket behind. A green run would then hide the exact
 * regression this teardown exists to prevent. The guard lives here, not only in
 * the teardown, so no other caller can route around it.
 */
export function demoDisabledAuthIdentifierKey(runSecret: string | undefined): string {
  if (typeof runSecret !== "string" || runSecret.length === 0) {
    // Names the variable and the rule; never its value.
    throw new Error(
      `${TEARDOWN_FATAL_PREFIX} ${DEMO_DISABLED_RUN_SECRET_ENV} is missing or empty, so the run's exact rate-limit key cannot be derived. Refusing to fall back to the development digest salt, which would compute a different key and silently leave the real one behind.`,
    );
  }

  const authIdentifierPolicyId = RATE_LIMIT_POLICIES.AUTH_IDENTIFIER.id;

  const owned = demoRateLimitKeys({
    userId: null,
    email: DEMO_DISABLED_PROBE_EMAIL,
    secret: runSecret,
  }).filter((key) => key.includes(`:${authIdentifierPolicyId}:`));

  const key = owned[0];
  if (owned.length !== 1 || !key) {
    throw new Error(
      `expected exactly one ${authIdentifierPolicyId} key for the demo-disabled probe, got ${String(owned.length)}`,
    );
  }
  return key;
}
