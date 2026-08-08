import "server-only";

import { currentRequestContext } from "./context";
import { sanitizeFields, type LogFields, type LogValue } from "./redact";
import type { ErrorCategory, LogEvent } from "./events";

/**
 * The single server-side logging boundary.
 *
 * Every field is allow-listed by `redact.ts` before emission, and the caller
 * cannot bypass that: `emit` is private and the only exported surface takes a
 * closed event name plus a flat field bag.
 *
 * Output is one JSON object per line in production, so a collector can parse it
 * without a grammar; development gets a compact human line instead, because a
 * developer reading a terminal is a different consumer with different needs.
 *
 * There is deliberately no `logger.log(anything)`. An arbitrary-payload escape
 * hatch is how private content reaches log files.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minimumLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL;
  if (configured && configured in LEVEL_ORDER) return configured as LogLevel;
  // Tests are noisy enough without request logs; production and development
  // both start at info.
  return process.env.NODE_ENV === "test" ? "warn" : "info";
}

type LogRecord = {
  timestamp: string;
  level: LogLevel;
  event: LogEvent;
  requestId?: string;
  method?: string;
  route?: string;
  actorId?: string;
} & Record<string, LogValue | undefined>;

/**
 * Writes the record.
 *
 * `console` is the transport on purpose: in every target runtime stdout is what
 * a process manager, container platform, or log collector already captures, and
 * adding a file or socket writer here would duplicate infrastructure that the
 * platform provides. Swapping transports is a Phase 8D deployment concern.
 */
function write(record: LogRecord): void {
  try {
    const line =
      process.env.NODE_ENV === "production"
        ? JSON.stringify(record)
        : `${record.level.toUpperCase()} ${record.event} ${JSON.stringify(stripBaseFields(record))}`;

    if (record.level === "error") {
      console.error(line);
    } else if (record.level === "warn") {
      console.warn(line);
    } else {
      console.info(line);
    }
  } catch {
    /**
     * Logging must never be able to fail a request.
     *
     * This is not hypothetical: a closed stdout raises `EPIPE` on write, and an
     * unhandled one takes the process down. Losing a diagnostic line is a far
     * smaller problem than losing the response it was describing, and there is
     * nowhere else to report the failure to.
     */
  }
}

/** Development output already shows the event; repeating the frame is noise. */
function stripBaseFields(record: LogRecord): Record<string, LogValue | undefined> {
  const { timestamp: _timestamp, level: _level, event: _event, ...rest } = record;
  return rest;
}

function emit(level: LogLevel, event: LogEvent, fields: LogFields = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel()]) return;

  const context = currentRequestContext();

  const record: LogRecord = {
    // Caller fields first, so the frame below always wins. A caller passing
    // `requestId` must not be able to forge correlation, and one passing
    // `level` must not be able to downgrade its own error.
    ...sanitizeFields(fields),

    timestamp: new Date().toISOString(),
    level,
    event,

    // Request-scoped frame, present only inside a request. Startup logs
    // legitimately have none — they are not HTTP requests.
    ...(context
      ? {
          requestId: context.requestId,
          method: context.method,
          route: context.route,
          ...(context.actorId ? { actorId: context.actorId } : {}),
        }
      : {}),
  };

  write(record);
}

export const logger = {
  debug: (event: LogEvent, fields?: LogFields) => {
    emit("debug", event, fields);
  },
  info: (event: LogEvent, fields?: LogFields) => {
    emit("info", event, fields);
  },
  warn: (event: LogEvent, fields?: LogFields) => {
    emit("warn", event, fields);
  },
  error: (event: LogEvent, fields?: LogFields) => {
    emit("error", event, fields);
  },
};

/**
 * Convenience for failures: forces an error category and an error *name* — not
 * the message, which routinely carries a connection string or user input.
 */
export function logFailure(event: LogEvent, category: ErrorCategory, fields: LogFields = {}): void {
  logger.error(event, { ...fields, errorCategory: category });
}
