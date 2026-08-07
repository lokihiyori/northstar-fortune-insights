import "server-only";

import type { NextResponse } from "next/server";
import { apiError, type ApiError } from "@/lib/api/response";
import {
  digestIdentifier,
  digestIp,
  normalizeIdentifier,
  parseProxyTrust,
  resolveClientIp,
  userSubject,
} from "./identity";
import { consume, peek, type RateLimitResult } from "./limiter";
import { policiesFor, type OperationName, type RateLimitPolicy } from "./policies";

/**
 * The single decision point between a protected operation and the limiter.
 *
 * Route Handlers and Server Actions both come through here, so an operation
 * reachable two ways cannot end up limited on one path and open on the other.
 * Callers never see a policy, a key, or a Redis error.
 */

/** Everything the limiter may know about a request. */
export type LimitContext = {
  headers: Headers;
  /** Present for authenticated operations. */
  userId?: string | undefined;
  /** Raw login identifier for credential flows. Normalized and hashed here. */
  identifier?: string | undefined;
};

export type EnforcementDecision =
  | { kind: "allow" }
  | {
      kind: "limit";
      policyId: string;
      retryAfterSeconds: number;
      resetAt: Date;
    }
  /** A fail-closed policy could not be evaluated. This is a 503, never a 429. */
  | { kind: "unavailable"; policyId: string };

/**
 * The subject a policy counts against, or `null` to skip it.
 *
 * Skipping is correct rather than lenient: a per-IP policy with no trustworthy
 * address has nothing to count, and a per-user policy on an anonymous request
 * has no user. Falling back to a shared bucket would let one caller exhaust
 * everybody's allowance at once.
 */
function subjectFor(policy: RateLimitPolicy, context: LimitContext): string | null {
  const secret = process.env.AUTH_SECRET;

  switch (policy.subject) {
    case "user":
      return context.userId ? userSubject(context.userId) : null;

    case "identifier": {
      if (!context.identifier) return null;
      const normalized = normalizeIdentifier(context.identifier);
      if (normalized.length === 0) return null;
      return digestIdentifier(normalized, secret);
    }

    case "ip": {
      const trust = parseProxyTrust(process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS);
      const ip = resolveClientIp(context.headers, trust);
      return ip ? digestIp(ip, secret) : null;
    }
  }
}

/**
 * Turns one policy's result into a decision, applying its failure mode.
 *
 * A fail-open policy that could not be evaluated records a diagnostic and
 * allows the request: no key, no subject, no address — only the policy id and
 * the fact that Redis did not answer.
 */
function apply(policy: RateLimitPolicy, result: RateLimitResult): EnforcementDecision {
  if (result.status === "limited") {
    return {
      kind: "limit",
      policyId: result.policyId,
      retryAfterSeconds: result.retryAfterSeconds,
      resetAt: result.resetAt,
    };
  }

  if (result.status === "unavailable") {
    if (policy.failureMode === "closed") {
      return { kind: "unavailable", policyId: policy.id };
    }
    console.warn(`[rate-limit] ${policy.id}: Redis unavailable, continuing (fail-open policy).`);
  }

  return { kind: "allow" };
}

/**
 * Evaluates every policy for an operation.
 *
 * `always` policies are consumed here. `on-failure` policies are only *peeked*,
 * so an attempt that succeeds costs nothing — the caller reports a failure
 * afterwards with `recordFailedAttempt`.
 */
export async function enforce(
  operation: OperationName,
  context: LimitContext,
): Promise<EnforcementDecision> {
  let deferred: EnforcementDecision | null = null;

  for (const policy of policiesFor(operation)) {
    const subject = subjectFor(policy, context);
    if (!subject) continue;

    const result =
      policy.counting === "on-failure"
        ? await peek(policy, subject)
        : await consume(policy, subject);

    const decision = apply(policy, result);

    // A genuine limit wins immediately; an outage is held back in case a later
    // policy produces a real limit, which is the more accurate answer.
    if (decision.kind === "limit") return decision;
    if (decision.kind === "unavailable") deferred ??= decision;
  }

  return deferred ?? { kind: "allow" };
}

/**
 * Charges an attempt against the `on-failure` policies of an operation.
 *
 * Called after a credential attempt is rejected. Successful attempts never
 * reach here, which is what stops a person locking themselves out by signing in
 * legitimately several times.
 */
export async function recordFailedAttempt(
  operation: OperationName,
  context: LimitContext,
): Promise<void> {
  for (const policy of policiesFor(operation)) {
    if (policy.counting !== "on-failure") continue;

    const subject = subjectFor(policy, context);
    if (!subject) continue;

    await consume(policy, subject);
  }
}

// ---------------------------------------------------------------------------
// Response mapping
// ---------------------------------------------------------------------------

/**
 * Deliberately identical for every operation and every subject.
 *
 * It names no account, no address, and no bucket. On a sign-in form this is the
 * whole enumeration defence: an attacker must not be able to tell a locked
 * account from an address that was never registered.
 */
export const RATE_LIMITED_MESSAGE = "Too many attempts. Please wait a moment and try again.";

export const UNAVAILABLE_MESSAGE =
  "This service is temporarily unavailable. Please try again shortly.";

/**
 * The Route Handler form: a response to return, or `null` to carry on.
 *
 * Neither branch reveals which policy fired, what the limit is, or that Redis
 * exists — an attacker learning which bucket they tripped learns how to avoid
 * it next time.
 */
export function rateLimitResponse(decision: EnforcementDecision): NextResponse<ApiError> | null {
  if (decision.kind === "allow") return null;

  if (decision.kind === "limit") {
    return apiError("RATE_LIMITED", RATE_LIMITED_MESSAGE, {
      headers: { "Retry-After": String(decision.retryAfterSeconds) },
    });
  }

  // Fail-closed with no Redis. A 429 here would be a lie about the cause, and
  // would tell the user to wait out a window that does not exist.
  console.warn(
    `[rate-limit] ${decision.policyId}: Redis unavailable, refusing (fail-closed policy).`,
  );
  return apiError("SERVICE_UNAVAILABLE", UNAVAILABLE_MESSAGE, {
    headers: { "Retry-After": "30" },
  });
}

/** Convenience for handlers: enforce and map in one step. */
export async function enforceApi(
  operation: OperationName,
  context: LimitContext,
): Promise<NextResponse<ApiError> | null> {
  return rateLimitResponse(await enforce(operation, context));
}

/**
 * The Server Action form.
 *
 * Actions return form state rather than HTTP responses, so they get a message
 * and the retry hint instead. The message is the same string the API returns.
 */
export type ActionLimitResult = {
  message: string;
  retryAfterSeconds: number;
} | null;

export function actionLimitResult(decision: EnforcementDecision): ActionLimitResult {
  if (decision.kind === "allow") return null;

  if (decision.kind === "limit") {
    return { message: RATE_LIMITED_MESSAGE, retryAfterSeconds: decision.retryAfterSeconds };
  }

  console.warn(
    `[rate-limit] ${decision.policyId}: Redis unavailable, refusing (fail-closed policy).`,
  );
  return { message: UNAVAILABLE_MESSAGE, retryAfterSeconds: 30 };
}

export async function enforceAction(
  operation: OperationName,
  context: LimitContext,
): Promise<ActionLimitResult> {
  return actionLimitResult(await enforce(operation, context));
}
