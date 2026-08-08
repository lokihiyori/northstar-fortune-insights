import { NextResponse } from "next/server";
import type { z } from "zod";
import { currentRequestId } from "@/lib/observability/context";
import { newRequestId } from "@/lib/observability/request-id";

/** Spec section 11: the only two response shapes a v1 endpoint may return. */
export type ApiSuccess<T> = {
  data: T;
  meta?: Record<string, unknown>;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
    requestId: string;
  };
};

export const ERROR_CODES = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL: "INTERNAL",
  // A dependency the endpoint cannot serve without is down. Distinct from
  // RATE_LIMITED on purpose: telling a user they sent too many requests when
  // the real cause is our own outage sends them away to wait for nothing.
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
};

export function apiSuccess<T>(
  data: T,
  init?: { status?: number; meta?: Record<string, unknown> },
): NextResponse<ApiSuccess<T>> {
  const body: ApiSuccess<T> = init?.meta ? { data, meta: init.meta } : { data };
  return NextResponse.json(body, { status: init?.status ?? 200 });
}

export function apiError(
  code: ErrorCode,
  message: string,
  init?: {
    fieldErrors?: Record<string, string[]>;
    status?: number;
    /** Extra response headers, e.g. `Retry-After` on a 429 or 503. */
    headers?: Record<string, string>;
  },
): NextResponse<ApiError> {
  /**
   * The *request's* id, not a fresh one per error.
   *
   * A user quoting this id must land an operator on the log line for the same
   * request, and two errors inside one request must not produce two different
   * ids. Falls back to a generated id only outside a request context — a unit
   * test, or a code path that has not been wrapped.
   */
  const requestId = currentRequestId() ?? newRequestId();

  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(init?.fieldErrors ? { fieldErrors: init.fieldErrors } : {}),
        requestId,
      },
    },
    {
      status: init?.status ?? STATUS[code],
      ...(init?.headers ? { headers: init.headers } : {}),
    },
  );
}

/** Flatten a Zod error into the `fieldErrors` shape the API contract defines. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (result[key] ??= []).push(issue.message);
  }

  return result;
}
