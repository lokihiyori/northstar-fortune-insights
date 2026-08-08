/**
 * What may appear in a log line.
 *
 * The rule is **allow-list, not deny-list**. A deny-list is a list of the leaks
 * someone already thought of; anything new is logged by default and discovered
 * later in a support ticket. Here a field has to be named to survive, and its
 * value has to be a primitive.
 *
 * Pure, so the whole policy is unit testable without a logger or a request.
 */

/**
 * Names that can never be logged, whatever they are called or shaped like.
 *
 * Credentials have no safe derived form: `sessionToken`, `tokenCount`, and
 * `apiKeyPrefix` are all refused, because a "safe" projection of a secret is
 * exactly the kind of thing that turns out not to be.
 */
const CREDENTIAL_NAMES =
  /password|passphrase|secret|token|cookie|authorization|credential|apikey|api_key|dsn|signature|salt|\bkey\b|hash/i;

/**
 * Names that carry user or source content.
 *
 * Substring matching is deliberate: `userEmail`, `email_address`, and
 * `contactEmail` must all be caught. Mirrors `FORBIDDEN_PROPERTY_KEYS` in
 * features/analytics/event-names.ts and extends it for logging.
 */
const CONTENT_NAMES =
  /question|answer|comment|note|prose|summary|content|text|body|email|prompt|report|passage|chunk|payload|message|title|url|connection|query|header|address|name/i;

/**
 * Suffixes that turn a content word into an identifier or a measurement.
 *
 * `reportId` is an opaque cuid, `chunkCount` is an integer, `questionLength` is
 * a number — none of them is the content itself, and refusing them would cost
 * real diagnostic signal for no privacy gain. This exemption never applies to
 * credentials.
 */
const MEASUREMENT_SUFFIX = /(Id|Ids|Count|Length|Size|Ms|Bytes|Index|Version|Stage|Status)$/;

/** True when a field name may not be emitted. */
export function isForbiddenFieldName(key: string): boolean {
  if (CREDENTIAL_NAMES.test(key)) return true;
  if (!CONTENT_NAMES.test(key)) return false;
  return !MEASUREMENT_SUFFIX.test(key);
}

/** Values a log field may hold. Objects and arrays are never serialized. */
export type LogValue = string | number | boolean | null;

/** Anything a caller might pass; filtered down to `LogValue` before emission. */
export type LogFields = Record<string, unknown>;

/**
 * Long strings are truncated rather than dropped.
 *
 * A field that passes the name check can still carry an unexpectedly large
 * value — a stringified object, a pasted document. Truncating bounds the damage
 * and keeps one log line from filling a disk.
 */
const MAX_STRING_LENGTH = 256;

/**
 * Characters that would let a value forge a second log entry or corrupt a JSON
 * consumer. Stripped rather than escaped, because nothing legitimate in an
 * allowed field contains them.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;

function sanitizeString(value: string): string {
  const cleaned = value.replace(CONTROL_CHARACTERS, " ");
  return cleaned.length > MAX_STRING_LENGTH
    ? `${cleaned.slice(0, MAX_STRING_LENGTH)}…[truncated]`
    : cleaned;
}

/**
 * Reduces caller-supplied fields to what may be emitted.
 *
 * Rejected: forbidden names, objects, arrays, functions, symbols, `undefined`,
 * and non-finite numbers. An object is never walked — that is how private
 * content reaches a log by accident, and there is no field in this application
 * whose meaning requires nesting.
 */
export function sanitizeFields(fields: LogFields): Record<string, LogValue> {
  const safe: Record<string, LogValue> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (isForbiddenFieldName(key)) continue;

    if (value === null) {
      safe[key] = null;
      continue;
    }

    switch (typeof value) {
      case "string":
        safe[key] = sanitizeString(value);
        break;
      case "number":
        if (Number.isFinite(value)) safe[key] = value;
        break;
      case "boolean":
        safe[key] = value;
        break;
      default:
      // Objects, arrays, functions, symbols, bigints, undefined: dropped.
    }
  }

  return safe;
}

/**
 * Reduces an unknown thrown value to a name, without its message.
 *
 * An exception message routinely carries a connection string, a SQL fragment,
 * or the user's own input. The name plus the log's event and category is enough
 * to find the code path; the message is not worth the leak.
 */
export function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name.length > 0 ? sanitizeString(error.name) : "Error";
  }
  return typeof error;
}

/**
 * A partial email, for the rare case where an operator genuinely needs to
 * recognise an account in a log.
 *
 * Not used on any current path — every log site uses an opaque user id instead.
 * Kept and tested so that if the need appears, the safe form already exists
 * rather than being improvised at the call site.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);
  const dot = domain.lastIndexOf(".");
  const tld = dot >= 0 ? domain.slice(dot) : "";

  return `${head}***@***${tld}`;
}
