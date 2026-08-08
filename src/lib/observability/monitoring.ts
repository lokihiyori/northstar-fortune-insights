import "server-only";

import { currentRequestContext } from "./context";
import { logger } from "./logger";
import { errorName, sanitizeFields, type LogFields, type LogValue } from "./redact";
import type { ErrorCategory } from "./events";

/**
 * Vendor-neutral error monitoring.
 *
 * Business code calls `captureException` and never learns whether a vendor
 * exists. That is the whole point: a monitoring SDK is the kind of dependency
 * that ends up imported in forty files and then cannot be replaced, and one
 * that runs third-party code on the request path.
 *
 * **No vendor is configured in Phase 8C.** The default adapter writes a
 * structured log line, which means capture works, is testable, and is visible —
 * it simply does not leave the process. See ADR 0009 for how to attach one.
 */

export type MonitoringSeverity = "warning" | "error";

/** Context an adapter receives. Already sanitized; never raw request data. */
export type MonitoringContext = {
  requestId?: string;
  route?: string;
  method?: string;
  actorId?: string;
  errorCategory?: ErrorCategory;
  extra: Record<string, LogValue>;
};

export type MonitoringAdapter = {
  name: string;
  captureException: (error: unknown, context: MonitoringContext) => void;
  captureMessage: (
    message: string,
    severity: MonitoringSeverity,
    context: MonitoringContext,
  ) => void;
};

/**
 * The default adapter.
 *
 * Deliberately not a silent no-op: a capture that vanishes is indistinguishable
 * from a capture that was never wired up, and that difference is exactly what
 * someone will need to know when the first vendor is attached.
 */
const structuredLogAdapter: MonitoringAdapter = {
  name: "structured-log",
  captureException: (error, context) => {
    logger.error("error.captured", {
      ...context.extra,
      errorType: errorName(error),
      errorCategory: context.errorCategory ?? "internal",
    });
  },
  captureMessage: (message, severity, context) => {
    // `label`, not `message`: a field called `message` is refused by the
    // redaction policy, and rightly — the name invites interpolated user text.
    // Callers pass a developer-authored constant, which is still truncated and
    // control-stripped like any other value.
    const fields = { ...context.extra, label: message };
    if (severity === "error") logger.error("error.captured", fields);
    else logger.warn("error.captured", fields);
  },
};

let adapter: MonitoringAdapter = structuredLogAdapter;

/**
 * Installs a vendor adapter.
 *
 * Intended to be called once, from `instrumentation.ts`, so exactly one place
 * in the codebase knows which vendor is in use. Nothing calls it today.
 */
export function setMonitoringAdapter(next: MonitoringAdapter): void {
  adapter = next;
}

/** Restores the built-in adapter. Exists for tests. */
export function resetMonitoringAdapter(): void {
  adapter = structuredLogAdapter;
}

export function activeMonitoringAdapterName(): string {
  return adapter.name;
}

/**
 * Builds the context an adapter sees.
 *
 * Everything is drawn from the request context or run through the same
 * allow-list the logger uses. An adapter can therefore never receive a header,
 * a cookie, a body, or a question — not because the vendor promises not to look
 * at them, but because they are not passed.
 */
function buildContext(fields: LogFields, category?: ErrorCategory): MonitoringContext {
  const request = currentRequestContext();

  return {
    ...(request?.requestId ? { requestId: request.requestId } : {}),
    ...(request?.route ? { route: request.route } : {}),
    ...(request?.method ? { method: request.method } : {}),
    ...(request?.actorId ? { actorId: request.actorId } : {}),
    ...(category ? { errorCategory: category } : {}),
    extra: sanitizeFields(fields),
  };
}

/**
 * Reports an exception.
 *
 * **Monitoring must never be able to fail a request.** A vendor SDK can throw
 * on a bad payload, block on a dead socket, or be misconfigured at runtime;
 * none of that is a reason to turn a working response into a 500. A failure
 * here is itself logged, once, and swallowed.
 */
export function captureException(
  error: unknown,
  options: { category?: ErrorCategory; fields?: LogFields } = {},
): void {
  try {
    adapter.captureException(error, buildContext(options.fields ?? {}, options.category));
  } catch {
    reportAdapterFailure();
  }
}

/**
 * Reports a noteworthy condition that is not an exception.
 *
 * `message` must be a developer-authored constant. Interpolating user input
 * into it would smuggle content past the field allow-list, which inspects
 * names rather than reading values.
 */
export function captureMessage(
  message: string,
  severity: MonitoringSeverity = "warning",
  options: { category?: ErrorCategory; fields?: LogFields } = {},
): void {
  try {
    adapter.captureMessage(message, severity, buildContext(options.fields ?? {}, options.category));
  } catch {
    reportAdapterFailure();
  }
}

function reportAdapterFailure(): void {
  try {
    logger.warn("monitoring.capture_failed", { adapter: adapter.name });
  } catch {
    // The logger itself failed. There is nowhere left to report to, and a
    // request must not die because its diagnostics did.
  }
}
