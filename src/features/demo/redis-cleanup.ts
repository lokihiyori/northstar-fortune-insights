import { RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";
import { digestIdentifier, normalizeIdentifier, userSubject } from "@/lib/rate-limit/identity";

/**
 * Redis keys the demo reset may remove.
 *
 * Only keys it can *compute* — never a scan, never a pattern delete, never
 * `FLUSHDB`. Rate-limit subjects are HMAC digests, so the exact key for a given
 * policy and subject is derivable; anything not derivable belongs to somebody
 * else and is left alone.
 *
 * Explicitly preserved:
 *   - `northstar:retrieval:*` — the shared retrieval cache and its monotonic
 *     generation counter. Owned by no user, and clearing the counter would
 *     resurrect entries that publishing had invalidated (ADR 0004).
 *   - every per-IP bucket. An address is shared with whoever else sits behind
 *     it, and with `RATE_LIMIT_TRUSTED_PROXY_HOPS` unset those are inert anyway.
 *   - every other user's buckets, which by construction have different digests.
 *
 * The prefix is duplicated from `lib/rate-limit/limiter` rather than imported,
 * because that module is `server-only` and this one has to run inside the
 * operator CLI. `tests/unit/demo-redis-cleanup.test.ts` asserts the two agree,
 * so the copy cannot drift silently.
 */
const RATE_LIMIT_KEY_PREFIX = "northstar:rl:v1";

export function demoRateLimitKeys(args: {
  userId: string | null;
  email: string;
  secret: string | undefined;
}): string[] {
  const keys: string[] = [];
  const identifierDigest = digestIdentifier(normalizeIdentifier(args.email), args.secret);

  for (const policy of Object.values(RATE_LIMIT_POLICIES)) {
    if (policy.subject === "identifier") {
      keys.push(`${RATE_LIMIT_KEY_PREFIX}:${policy.id}:${identifierDigest}`);
    } else if (policy.subject === "user" && args.userId !== null) {
      keys.push(`${RATE_LIMIT_KEY_PREFIX}:${policy.id}:${userSubject(args.userId)}`);
    }
    // `ip` subjects are intentionally skipped — see the note above.
  }

  return keys;
}
