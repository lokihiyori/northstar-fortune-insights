import "server-only";

import { randomBytes } from "node:crypto";
import type Stripe from "stripe";

import { prisma } from "@/lib/db/prisma";
import type { CheckoutAttempt } from "@/generated/prisma/client";

/**
 * The per-user Checkout claim and its immutable Stripe request.
 *
 * Two properties this module exists to provide:
 *
 *  1. **At most one live attempt per user**, enforced by the `activeForUserId`
 *     unique index. The database elects the winner; no timing assumption, no
 *     lock TTL, and no Redis. Concurrent callers all converge on one row and
 *     therefore on one Stripe idempotency key.
 *
 *  2. **A request that never changes.** Stripe compares parameters when an
 *     idempotency key is reused, so anything recomputed on retry — an expiry
 *     from the clock, a URL from the environment, the currently configured
 *     Price — turns recovery into `idempotency_error`. `buildSessionRequest`
 *     therefore reads the row and nothing else.
 */

/** Bumped when the request shape changes; forces a new attempt, never a mutated one. */
export const CHECKOUT_REQUEST_VERSION = 1;

/** How long a Checkout Session is offered. Stripe permits 30 minutes to 24 hours. */
const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Crash-detection lease. Short on purpose: a process that dies between claiming
 * and calling Stripe would otherwise strand the user until the long expiry.
 */
const LEASE_TTL_MS = 30 * 1000;

/**
 * Attempt lifetime, deliberately **below Stripe's 24-hour idempotency-key
 * retention**. The local row must expire before the remote key does, so the
 * failure mode is "start a fresh attempt", never "silently create a second
 * Session because the key stopped deduplicating".
 */
const ATTEMPT_TTL_MS = 20 * 60 * 60 * 1000;

export type AttemptMetadata = { userId: string; attemptId: string };

/** Opaque, per-attempt, unguessable. Never derived from a user id. */
function newCustomerIdemKey(): string {
  return `nsc_${randomBytes(24).toString("hex")}`;
}

/**
 * The Stripe idempotency key for this attempt's Session creation.
 *
 * Derived from the attempt id alone, so every caller that reaches the same row —
 * the original processor, a takeover after a crash, a retry after a lost
 * response — presents an identical key.
 */
export function sessionIdempotencyKey(attempt: Pick<CheckoutAttempt, "id">): string {
  return `checkout:v1:${attempt.id}`;
}

export type ClaimInput = {
  userId: string;
  priceId: string;
  appUrl: string;
  now: Date;
};

export type ClaimResult =
  | { kind: "claimed"; attempt: CheckoutAttempt }
  /** Another request holds the claim. Its row is returned for inspection. */
  | { kind: "exists"; attempt: CheckoutAttempt };

/**
 * Claims the user's single live attempt, or reports the existing one.
 *
 * **The claim is taken before any Stripe call**, and `stripeCustomerId` starts
 * null. An earlier design resolved the Customer first, which let two concurrent
 * first-time requests create two Stripe Customers before either wrote one down.
 */
export async function claimAttempt(input: ClaimInput): Promise<ClaimResult> {
  const expiresAt = new Date(input.now.getTime() + ATTEMPT_TTL_MS);

  // Truncated to whole seconds: this value is sent to Stripe as an integer
  // number of seconds, and every retry must produce the identical integer.
  const requestedSessionExpiresAt = new Date(
    Math.floor((input.now.getTime() + SESSION_TTL_MS) / 1000) * 1000,
  );

  try {
    const attempt = await prisma.checkoutAttempt.create({
      data: {
        userId: input.userId,
        activeForUserId: input.userId,
        status: "PENDING",
        requestVersion: CHECKOUT_REQUEST_VERSION,
        requestedSessionExpiresAt,
        successUrl: `${input.appUrl}/app/billing?checkout=success`,
        cancelUrl: `${input.appUrl}/app/billing?checkout=cancelled`,
        stripePriceId: input.priceId,
        allowPromotionCodes: true,
        // Placeholder replaced immediately below; the row id is not known until
        // the insert returns, and the metadata must carry it.
        metadataJson: {},
        customerIdemKey: newCustomerIdemKey(),
        leaseExpiresAt: new Date(input.now.getTime() + LEASE_TTL_MS),
        expiresAt,
      },
    });

    // Freeze the metadata now that the id exists. This is still before any
    // Stripe call, so the snapshot is complete before it can ever be replayed.
    const metadata: AttemptMetadata = { userId: input.userId, attemptId: attempt.id };
    const frozen = await prisma.checkoutAttempt.update({
      where: { id: attempt.id },
      data: { metadataJson: metadata },
    });

    return { kind: "claimed", attempt: frozen };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const existing = await prisma.checkoutAttempt.findUnique({
      where: { activeForUserId: input.userId },
    });
    // The winner may have terminalized between the failed insert and this read.
    if (!existing) return claimAttempt(input);
    return { kind: "exists", attempt: existing };
  }
}

/** Prisma's unique-constraint failure, without importing the error class. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Builds the Stripe request from the row.
 *
 * **Reads no clock, no environment variable, no live Price lookup, and no
 * mutable user data.** A deployment, an app-URL change, a clock adjustment, or a
 * Price reconfiguration must not alter an attempt that is already in flight,
 * because Stripe would then reject the replay instead of returning the original
 * Session.
 */
export function buildSessionRequest(attempt: CheckoutAttempt): Stripe.Checkout.SessionCreateParams {
  const customerId = attempt.stripeCustomerId;
  if (!customerId) {
    throw new Error("buildSessionRequest requires a resolved Stripe customer");
  }

  const metadata = attempt.metadataJson as unknown as AttemptMetadata;

  return {
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: attempt.stripePriceId, quantity: 1 }],
    success_url: attempt.successUrl,
    cancel_url: attempt.cancelUrl,
    allow_promotion_codes: attempt.allowPromotionCodes,
    // Exact integer seconds, from the persisted value — never `Date.now()`.
    expires_at: Math.floor(attempt.requestedSessionExpiresAt.getTime() / 1000),
    metadata: { userId: metadata.userId, attemptId: metadata.attemptId },
    subscription_data: {
      metadata: { userId: metadata.userId, attemptId: metadata.attemptId },
    },
  };
}

/** True when nobody is actively processing this attempt. */
export function leaseHasLapsed(attempt: CheckoutAttempt, now: Date): boolean {
  return attempt.leaseExpiresAt.getTime() <= now.getTime();
}

/** Extends the lease so a takeover can proceed without a second takeover racing it. */
export async function takeOverLease(attemptId: string, now: Date): Promise<CheckoutAttempt> {
  return prisma.checkoutAttempt.update({
    where: { id: attemptId },
    data: { leaseExpiresAt: new Date(now.getTime() + LEASE_TTL_MS) },
  });
}

export async function recordSession(
  attemptId: string,
  sessionId: string,
  remoteExpiresAt: Date | null,
): Promise<CheckoutAttempt> {
  return prisma.checkoutAttempt.update({
    where: { id: attemptId },
    data: { status: "OPEN", stripeSessionId: sessionId, remoteExpiresAt },
  });
}

export async function recordCustomer(
  attemptId: string,
  stripeCustomerId: string,
): Promise<CheckoutAttempt> {
  return prisma.checkoutAttempt.update({
    where: { id: attemptId },
    data: { stripeCustomerId },
  });
}

/**
 * Ends an attempt and releases the user's claim.
 *
 * Clearing `activeForUserId` is what frees the unique index. Terminal states are
 * terminal: this never moves an attempt out of COMPLETED, EXPIRED, or FAILED, so
 * a replayed or out-of-order event cannot reopen one.
 */
export async function terminalizeAttempt(
  attemptId: string,
  status: "COMPLETED" | "EXPIRED" | "FAILED",
): Promise<void> {
  await prisma.checkoutAttempt.updateMany({
    where: { id: attemptId, status: { in: ["PENDING", "OPEN"] } },
    data: { status, activeForUserId: null },
  });
}

export async function liveAttemptForUser(userId: string): Promise<CheckoutAttempt | null> {
  return prisma.checkoutAttempt.findUnique({ where: { activeForUserId: userId } });
}
