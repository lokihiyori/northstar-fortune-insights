import "server-only";

import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { runWithRequestContext } from "./context";
import { errorCategoryForCode } from "./events";
import { logger } from "./logger";
import { captureException } from "./monitoring";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

/**
 * Request lifecycle for Route Handlers.
 *
 * One wrapper does four things that would otherwise be repeated, and forgotten,
 * in every handler:
 *
 *   1. establishes the request context, so `apiError` and every nested log line
 *      share one id;
 *   2. returns that id as `X-Request-ID`, so a user can quote it;
 *   3. records completion with method, route template, status, and duration;
 *   4. converts an escaped exception into the standard error envelope instead
 *      of Next's default 500 page, which would answer an API caller with HTML.
 *
 * The route *template* is passed in rather than derived from the URL: a raw
 * path carries ids and query strings, and a template groups logs usefully.
 */

export type ApiHandler<TArgs extends unknown[]> = (
  request: Request,
  ...args: TArgs
) => Promise<Response> | Response;

export type RequestLoggingOptions = {
  /**
   * Log successful responses. Turned off for liveness, readiness, and the
   * generation-status endpoint the client polls every 1.2 seconds — those would
   * bury real signal under probe traffic. Failures are always logged.
   */
  logSuccess?: boolean;
};

/** 5xx is ours; 4xx is the caller's and is not an error-level event. */
function levelForStatus(status: number): "info" | "warn" | "error" {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

export function withApiLogging<TArgs extends unknown[]>(
  route: string,
  handler: ApiHandler<TArgs>,
  options: RequestLoggingOptions = {},
): (request: Request, ...args: TArgs) => Promise<Response> {
  const logSuccess = options.logSuccess ?? true;

  return async function wrapped(request: Request, ...args: TArgs): Promise<Response> {
    const { requestId, source } = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    const method = request.method;
    const startedAt = Date.now();

    return runWithRequestContext({ requestId, route, method }, async () => {
      try {
        const response = await handler(request, ...args);
        const durationMs = Date.now() - startedAt;

        // Set on the response we return, not a copy: the handler may have set
        // its own headers (Retry-After, for one) and they must survive.
        response.headers.set("X-Request-ID", requestId);

        const level = levelForStatus(response.status);
        if (level !== "info" || logSuccess) {
          logger[level]("http.request_completed", {
            status: response.status,
            durationMs,
            // Whether the caller supplied a usable id, so a rejected one is
            // visible without logging the rejected value itself.
            requestIdSource: source,
          });
        }

        return response;
      } catch (error) {
        const durationMs = Date.now() - startedAt;

        // The handler threw rather than returning an envelope. Report it, then
        // answer in the shape every other endpoint uses — an API caller must
        // never receive an HTML error page.
        logger.error("http.request_failed", {
          status: 500,
          durationMs,
          errorCategory: errorCategoryForCode("INTERNAL"),
        });
        captureException(error, { category: "internal" });

        const response = apiError("INTERNAL", "Something went wrong. Please try again.");
        response.headers.set("X-Request-ID", requestId);
        return response;
      }
    });
  };
}

/**
 * Adds the header to a response built outside the wrapper.
 *
 * Only needed where a route composes its own `NextResponse` before the wrapper
 * sees it; the wrapper is idempotent, so calling both is harmless.
 */
export function withRequestIdHeader(response: NextResponse, requestId: string): NextResponse {
  response.headers.set("X-Request-ID", requestId);
  return response;
}
