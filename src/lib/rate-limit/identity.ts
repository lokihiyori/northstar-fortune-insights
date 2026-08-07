/**
 * Who a rate limit is counted against, and how that is written down.
 *
 * Two rules shape this module:
 *
 *  1. **Nothing private reaches Redis.** A login identifier is normalized and
 *     then keyed-hashed. An email address, a password, a session token, or a
 *     user's question must never appear in a key or a value — Redis keyspaces
 *     get dumped into support tickets and monitoring tools.
 *
 *  2. **Forwarding headers are not evidence.** `X-Forwarded-For` is client
 *     input. It is only believed when the deployment declares how many proxies
 *     sit in front of the app.
 *
 * Pure and dependency-free apart from `node:crypto`, so every branch is unit
 * testable without a request.
 */

import { createHmac } from "node:crypto";

/**
 * How many trusted proxies sit between the client and this process.
 *
 * `0` means none, which is the default and means `X-Forwarded-For` is ignored
 * entirely. See `resolveClientIp` for what that costs.
 */
export type ProxyTrust = { trustedHops: number };

const MAX_TRUSTED_HOPS = 8;

export function parseProxyTrust(raw: string | undefined): ProxyTrust {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return { trustedHops: 0 };
  return { trustedHops: Math.min(parsed, MAX_TRUSTED_HOPS) };
}

/** Rejects anything that is not plausibly an address, including "unknown". */
function isIpLike(value: string): boolean {
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > 45) return false;

  // IPv4, optionally with a port stripped by the caller.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(candidate)) {
    return candidate.split(".").every((part) => Number(part) <= 255);
  }
  // IPv6, including the compressed and IPv4-mapped forms.
  return /^[0-9a-f:]+$/i.test(candidate) && candidate.includes(":");
}

function stripBrackets(value: string): string {
  const trimmed = value.trim();
  // `[::1]:53000` — the bracketed form used when a port is attached.
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(trimmed);
  if (bracketed?.[1]) return bracketed[1];
  return trimmed;
}

/**
 * The client address, or `null` when none can be trusted.
 *
 * **`null` is a deliberate outcome, not a failure.** With no declared proxy the
 * only address available is one the client wrote itself, and believing it would
 * let an attacker rotate through invented addresses — worse than no limit,
 * because it looks like protection. Callers skip per-IP policies in that case
 * and rely on the per-user and per-identifier policies, which are unaffected.
 *
 * Never fall back to a shared placeholder bucket: one attacker would then
 * exhaust the budget for every user at once.
 */
export function resolveClientIp(headers: Headers, trust: ProxyTrust): string | null {
  if (trust.trustedHops <= 0) return null;

  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;

  const chain = forwarded
    .split(",")
    .map((entry) => stripBrackets(entry))
    .filter((entry) => entry.length > 0);

  // Count from the right: entries nearer the right were appended by proxies
  // closer to us, so they are the ones we can actually vouch for. The left-hand
  // end is whatever the original client claimed.
  const index = chain.length - trust.trustedHops;
  const candidate = chain[index];
  if (!candidate) return null;

  return isIpLike(candidate) ? candidate.toLowerCase() : null;
}

/**
 * Normalizes a login identifier so trivial variations share one bucket.
 *
 * Case and surrounding whitespace only. Deliberately does **not** strip Gmail
 * dots or `+` tags: the application treats those as distinct accounts, and
 * collapsing them here would rate-limit one person's attempts against another
 * person's account.
 */
export function normalizeIdentifier(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Fallback digest key for development, where `AUTH_SECRET` is often unset.
 *
 * Rate-limit digests are collision- and preimage-resistance concerns, not
 * confidentiality of a stored secret, so a known development salt is
 * acceptable. Production always has `AUTH_SECRET` — startup validation refuses
 * to serve without it (Phase 8A).
 */
const DEV_DIGEST_SALT = "northstar-rate-limit-development-salt";

/**
 * A stable, non-reversible identifier bucket.
 *
 * Keyed rather than a plain hash: an unkeyed digest of an email address is
 * trivially reversed by hashing a wordlist, which would turn the Redis keyspace
 * back into a list of who tried to sign in.
 */
export function digestIdentifier(normalized: string, secret: string | undefined): string {
  const key = secret && secret.length > 0 ? secret : DEV_DIGEST_SALT;
  return createHmac("sha256", key).update(`identifier:${normalized}`).digest("hex").slice(0, 32);
}

/**
 * IPs are hashed too. They are personal data, they are not needed in readable
 * form to enforce a limit, and a keyspace listing should not double as a
 * visitor log.
 */
export function digestIp(ip: string, secret: string | undefined): string {
  const key = secret && secret.length > 0 ? secret : DEV_DIGEST_SALT;
  return createHmac("sha256", key).update(`ip:${ip}`).digest("hex").slice(0, 32);
}

/**
 * User ids are opaque cuids that are already safe in a key, so they are used
 * directly — a digest would only make debugging harder for no privacy gain.
 */
export function userSubject(userId: string): string {
  return userId;
}
