/**
 * The log event catalogue.
 *
 * Log events are a separate contract from the product analytics events in
 * `features/analytics/event-names.ts`: those describe what a user did and live
 * in PostgreSQL; these describe what the server did and go to stdout. Keeping
 * them apart stops operational noise from polluting product data.
 *
 * A closed union rather than free-form strings, so an event name cannot drift
 * between the code that emits it and the query that looks for it.
 *
 * Pure, with no `server-only`, so tests and documentation can reference it.
 */
export const LOG_EVENTS = [
  // --- process lifecycle ---------------------------------------------------
  "startup.env_validated",
  "startup.env_invalid",
  "startup.cache_ready",
  "startup.cache_unavailable",

  // --- HTTP ----------------------------------------------------------------
  "http.request_completed",
  "http.request_failed",

  // --- authentication ------------------------------------------------------
  // Category only. Never records whether the account exists — that would put
  // an enumeration oracle in the log file instead of the response body.
  "auth.sign_in_refused",
  "auth.sign_up_refused",

  // --- demo mode -----------------------------------------------------------
  // Category only, same rule as above: why the shared demo login was refused,
  // never the address or the configured password.
  "demo.sign_in_refused",

  // --- rate limiting -------------------------------------------------------
  "ratelimit.refused",
  "ratelimit.backend_unavailable",
  "ratelimit.degraded_open",

  // --- guidance pipeline ---------------------------------------------------
  "guidance.accepted",
  "guidance.completed",
  "guidance.failed",

  // --- source lifecycle ----------------------------------------------------
  "source.created",
  "source.updated",
  "source.ingested",
  "source.reviewed",
  "source.published",
  "source.retired",

  // --- operations ----------------------------------------------------------
  "readiness.checked",
  "error.captured",
  "monitoring.capture_failed",
  "analytics.write_failed",
  "billing.request_failed",
  "webhook.processing_failed",

  // --- billing concurrency and reconciliation ------------------------------
  // Identifiers and counts only. No amount, no card, no invoice, no email, and
  // never a Checkout URL — the redaction allow-list refuses any field whose name
  // matches `url`, which makes that last one structurally impossible.
  "billing.attempt_opened",
  "billing.blocked",
  "billing.duplicate_customer",
  "billing.duplicate_active_subscriptions",
  "billing.mode_mismatch",
  "billing.session_foreign_attempt",
  "billing.session_ambiguous",
  "billing.session_unexpected_shape",
  "billing.session_expire_unconfirmed",
  "billing.discovery_incomplete",
  "billing.reconcile_incomplete",
  "billing.reconcile_failure_unrecorded",
  "billing.attempt_mismatch",
  "billing.unmapped_customer_event",
  "billing.cross_linked_metadata",
] as const;

export type LogEvent = (typeof LOG_EVENTS)[number];

/**
 * Coarse buckets for failures.
 *
 * A category rather than a message: an exception message can contain a
 * connection string, a SQL fragment, or a user's input, and none of that
 * belongs in a log line that operations staff paste into a ticket.
 */
export const ERROR_CATEGORIES = [
  "validation",
  "authentication",
  "authorization",
  "not_found",
  "conflict",
  "rate_limited",
  "dependency_unavailable",
  "timeout",
  "internal",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/** Maps an API error code to its log category, so the two cannot drift. */
export function errorCategoryForCode(code: string): ErrorCategory {
  switch (code) {
    case "VALIDATION_FAILED":
      return "validation";
    case "UNAUTHENTICATED":
      return "authentication";
    case "FORBIDDEN":
      return "authorization";
    case "NOT_FOUND":
      return "not_found";
    case "CONFLICT":
      return "conflict";
    case "RATE_LIMITED":
      return "rate_limited";
    case "SERVICE_UNAVAILABLE":
      return "dependency_unavailable";
    default:
      return "internal";
  }
}
