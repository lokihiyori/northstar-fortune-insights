/**
 * Request identifiers.
 *
 * A request id is echoed back to the caller in a header, embedded in every
 * error envelope, and written to logs — so it is attacker-influenced data that
 * ends up in three places where injection matters. It is therefore validated
 * against a strict allow-list rather than sanitized, and replaced outright when
 * it does not match.
 *
 * Pure and free of `server-only` so every branch is unit testable and nothing
 * here constrains which runtime may use it.
 */

/** Header clients may use to supply their own correlation id. */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Deliberately narrow: letters, digits, hyphen, underscore.
 *
 * Excluding whitespace and control characters is what stops a crafted header
 * from injecting a newline into a log line and forging a second entry. A v4
 * UUID satisfies it, as does any sane upstream trace id.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

const MAX_LENGTH = 64;

export function isSafeRequestId(value: string): boolean {
  // Length first: bounding the input before it reaches the pattern keeps an
  // oversized header cheap to reject.
  if (value.length < 8 || value.length > MAX_LENGTH) return false;
  return SAFE_REQUEST_ID.test(value);
}

export type RequestIdResolution = {
  requestId: string;
  /** `incoming` when the caller's id was kept, `generated` when it was replaced. */
  source: "incoming" | "generated";
};

/**
 * Resolves the id for a request.
 *
 * An unusable id is silently replaced rather than rejected with an error: the
 * caller gets correlation either way, and refusing a request over a malformed
 * diagnostic header would be a poor trade.
 */
export function resolveRequestId(incoming: string | null | undefined): RequestIdResolution {
  if (typeof incoming === "string") {
    const candidate = incoming.trim();
    if (isSafeRequestId(candidate)) {
      return { requestId: candidate, source: "incoming" };
    }
  }

  return { requestId: newRequestId(), source: "generated" };
}

/**
 * `randomUUID` rather than `Math.random`: ids must not be guessable or collide.
 *
 * The **Web Crypto** global rather than `node:crypto`, deliberately. This module
 * is imported transitively by `instrumentation.ts`, which Next compiles for the
 * Edge runtime as well as Node; a `node:crypto` import there produces a real
 * build warning and would break if the module were ever used on Edge. The global
 * exists in both runtimes and does the same thing.
 */
export function newRequestId(): string {
  return crypto.randomUUID();
}
