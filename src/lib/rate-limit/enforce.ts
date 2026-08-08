import "server-only";

import type { NextResponse } from "next/server";
import { apiError, type ApiError } from "@/lib/api/response";
import { logger } from "@/lib/observability/logger";
import {
  digestIdentifier,
  digestIp,
  normalizeIdentifier,
  parseProxyTrust,
  resolveClientIp,
  userSubject,
} from "./identity";
import { consume, release, type RateLimitResult } from "./limiter";
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
    logger.warn("ratelimit.degraded_open", { policyId: policy.id });
  }

  return { kind: "allow" };
}

/** What a caller holds after a successful reservation, so it can be given back. */
export type Reservation = {
  /** Held (policy, subject) pairs, in acquisition order. */
  held: { policy: RateLimitPolicy; subject: string }[];
};

export type ReservationOutcome =
  | { kind: "allow"; reservation: Reservation }
  | { kind: "limit"; policyId: string; retryAfterSeconds: number; resetAt: Date }
  | { kind: "unavailable"; policyId: string };

/**
 * Gives back every reservation in a handle.
 *
 * Safe to call more than once and safe to call on an empty handle; the handle is
 * emptied as it goes so a double release cannot decrement twice.
 */
export async function releaseReservation(reservation: Reservation): Promise<void> {
  const held = reservation.held.splice(0, reservation.held.length);
  for (const entry of held) {
    await release(entry.policy, entry.subject);
  }
}

/**
 * Atomically reserves capacity across every applicable policy for an operation.
 *
 * **This is the gate.** Capacity is taken before the caller does any expensive
 * work, so no more than `limit` callers can be inside that work at once, however
 * many arrive at the same instant. The previous design read a count and then
 * decided, which is not atomic: a burst of concurrent callers all read the same
 * pre-attempt value and were all admitted.
 *
 * Acquisition is all-or-nothing. If a later policy denies — or cannot be
 * evaluated — every reservation already taken is released before returning, so a
 * refused attempt never leaves a phantom unit charged against a policy that
 * would have allowed it.
 */
export async function reserve(
  operation: OperationName,
  context: LimitContext,
): Promise<ReservationOutcome> {
  const reservation: Reservation = { held: [] };

  for (const policy of policiesFor(operation)) {
    const subject = subjectFor(policy, context);
    // No subject means nothing to count — never a shared fallback bucket.
    if (!subject) continue;

    const decision = apply(policy, await consume(policy, subject));

    if (decision.kind === "allow") {
      reservation.held.push({ policy, subject });
      continue;
    }

    // Roll back the partial acquisition before reporting the refusal.
    await releaseReservation(reservation);
    return decision;
  }

  return { kind: "allow", reservation };
}

/**
 * What a credential attempt turned out to be.
 *
 * Naming the three cases explicitly is the point: only the first is evidence
 * about the caller, and only the first may be charged.
 */
export type CredentialOutcome =
  /** The password was definitively wrong. Charge it. */
  | "invalid-credentials"
  /** The caller proved who they are. Give the reservation back. */
  | "authenticated"
  /**
   * Anything else — a provider configuration fault, a database error, an
   * unexpected exception. It says nothing about whether the caller knows the
   * password, so charging it would let an unrelated outage lock real people out.
   */
  | "indeterminate";

/**
 * Settles a credential attempt against its reservation.
 *
 * `invalid-credentials` commits by doing nothing: the unit was already counted
 * when it was reserved, which is exactly what makes the limit hold under
 * concurrency. The other two outcomes give the unit back.
 *
 * A release only ever returns the caller's own single unit, so a success cannot
 * erase failures other requests recorded in the same window.
 */
export async function settleCredentialAttempt(
  reservation: Reservation,
  outcome: CredentialOutcome,
): Promise<void> {
  if (outcome === "invalid-credentials") return;
  await releaseReservation(reservation);
}

/**
 * Evaluates every policy for an operation and keeps whatever it reserves.
 *
 * For operations where making the attempt is itself the cost — generation,
 * admin mutations, sign-up — there is nothing to give back, so this is `reserve`
 * with the handle discarded.
 */
export async function enforce(
  operation: OperationName,
  context: LimitContext,
): Promise<EnforcementDecision> {
  const outcome = await reserve(operation, context);
  return outcome.kind === "allow" ? { kind: "allow" } : outcome;
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
    // The policy id is an internal label, not a secret; it never reaches the
    // response. The subject is not logged at all — it is a digest of an account
    // or address, and a log of who was limited is a log of who tried.
    logger.warn("ratelimit.refused", {
      policyId: decision.policyId,
      retryAfterSeconds: decision.retryAfterSeconds,
    });
    return apiError("RATE_LIMITED", RATE_LIMITED_MESSAGE, {
      headers: { "Retry-After": String(decision.retryAfterSeconds) },
    });
  }

  // Fail-closed with no Redis. A 429 here would be a lie about the cause, and
  // would tell the user to wait out a window that does not exist.
  logger.error("ratelimit.backend_unavailable", { policyId: decision.policyId });
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
    logger.warn("ratelimit.refused", {
      policyId: decision.policyId,
      retryAfterSeconds: decision.retryAfterSeconds,
    });
    return { message: RATE_LIMITED_MESSAGE, retryAfterSeconds: decision.retryAfterSeconds };
  }

  logger.error("ratelimit.backend_unavailable", { policyId: decision.policyId });
  return { message: UNAVAILABLE_MESSAGE, retryAfterSeconds: 30 };
}

export async function enforceAction(
  operation: OperationName,
  context: LimitContext,
): Promise<ActionLimitResult> {
  return actionLimitResult(await enforce(operation, context));
}
