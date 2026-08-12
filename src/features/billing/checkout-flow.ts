import "server-only";

import type Stripe from "stripe";

import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/observability/logger";
import { captureMessage } from "@/lib/observability/monitoring";
import { getStripe, isBillingConfigured, plusPriceId } from "./stripe";
import {
  buildSessionRequest,
  claimAttempt,
  leaseHasLapsed,
  liveAttemptForUser,
  recordCustomer,
  recordSession,
  sessionIdempotencyKey,
  takeOverLease,
  terminalizeAttempt,
} from "./checkout-attempt";
import { blockBilling, persistCustomerMapping, resolveCustomer } from "./customer";
import { discoverOpenSessions, expireAndConfirm } from "./session-discovery";
import {
  deriveProjection,
  fetchMatchingSubscriptions,
  lockCustomer,
  writeProjection,
} from "./reconcile";
import { hasBlockingSubscription } from "./subscription-set";
import type { CheckoutAttempt } from "@/generated/prisma/client";

/**
 * The Checkout critical section.
 *
 * Every path that could return or create a Checkout URL runs through here, and
 * every one of them re-checks the authoritative subscription set while holding
 * the same per-customer advisory lock that webhook reconciliation takes. A
 * stored `stripeSessionId` never short-circuits that: a subscription can appear
 * through the Portal, the Dashboard, an older Session, or a delayed webhook
 * after a Session was opened, and continuing to offer that Session is exactly
 * how the second subscription in D1 was created.
 */

export type CheckoutOutcome =
  /** A verified, open Session. The URL is held in memory only — never persisted. */
  | { kind: "session"; url: string }
  /** Already subscribed, or an attempt is mid-flight elsewhere. */
  | { kind: "conflict"; message: string; retryAfterSeconds?: number }
  /** Operator intervention required. */
  | { kind: "blocked"; message: string }
  /** Stripe or the database could not answer. Never creates anything. */
  | { kind: "unavailable" };

const TX_OPTIONS = {
  // The Stripe read happens inside this transaction, under the advisory lock.
  // Stripe's own client timeout is set below this so the network call can never
  // outlive the transaction.
  timeout: 15_000,
  maxWait: 5_000,
};

const ALREADY_SUBSCRIBED =
  "You already have an active subscription. Manage it from the billing page.";
const IN_FLIGHT = "Your checkout is being prepared. Please try again in a moment.";
const BLOCKED_MESSAGE =
  "Billing is temporarily unavailable for this account. Please contact support.";

/**
 * Runs the authoritative check and, if a subscription exists, tears down any
 * open Session before releasing the attempt.
 *
 * Returns `null` when it is safe to continue toward a Session.
 */
async function refuseIfSubscribed(
  stripe: Stripe,
  attempt: CheckoutAttempt,
  args: { userId: string; customerId: string; priceId: string },
): Promise<CheckoutOutcome | null> {
  const fetched = await fetchMatchingSubscriptions(stripe, {
    customerId: args.customerId,
    userId: args.userId,
    priceId: args.priceId,
  });

  if (fetched.kind === "incomplete") {
    captureMessage("billing.reconcile_incomplete", "error", { fields: { userId: args.userId } });
    return { kind: "unavailable" };
  }

  if (!hasBlockingSubscription(fetched.matching)) return null;

  // A subscription exists. Any open Session for this attempt must be killed
  // before the claim is released, or it remains completable in the browser.
  if (attempt.stripeSessionId) {
    const confirmed = await expireAndConfirm(stripe, attempt.stripeSessionId);
    if (!confirmed) {
      captureMessage("billing.session_expire_unconfirmed", "error", {
        fields: { userId: args.userId, attemptId: attempt.id },
      });
      return { kind: "unavailable" };
    }
  }

  const projection = deriveProjection({ matching: fetched.matching });
  await prisma.$transaction(async (tx) => {
    await lockCustomer(tx, args.customerId);
    await writeProjection(tx, args.userId, projection, new Date());
  }, TX_OPTIONS);

  await terminalizeAttempt(attempt.id, "COMPLETED");
  return { kind: "conflict", message: ALREADY_SUBSCRIBED };
}

/**
 * Enumerates open Sessions and decides what may be offered.
 *
 * Ambiguity fails closed in every direction: two verified Sessions, a Session
 * belonging to another attempt, or an incomplete enumeration all refuse rather
 * than guess which one is safe.
 */
async function resolveSession(
  stripe: Stripe,
  attempt: CheckoutAttempt,
  args: { userId: string; customerId: string; priceId: string; now: Date },
): Promise<
  | { kind: "reuse"; session: Stripe.Checkout.Session }
  | { kind: "create" }
  | { kind: "refuse"; outcome: CheckoutOutcome }
> {
  const discovery = await discoverOpenSessions(stripe, {
    customerId: args.customerId,
    userId: args.userId,
    priceId: args.priceId,
    attemptId: attempt.id,
    now: args.now,
  });

  if (discovery.kind === "incomplete") {
    captureMessage("billing.discovery_incomplete", "error", { fields: { userId: args.userId } });
    return { kind: "refuse", outcome: { kind: "unavailable" } };
  }

  const foreign = discovery.candidates.filter((c) => c.kind === "foreign");
  if (foreign.length > 0) {
    captureMessage("billing.session_foreign_attempt", "error", {
      fields: { userId: args.userId, attemptId: attempt.id, sessionCount: foreign.length },
    });
    return { kind: "refuse", outcome: { kind: "unavailable" } };
  }

  const own = discovery.candidates.filter((c) => c.kind === "own");
  const legacy = discovery.candidates.filter((c) => c.kind === "legacy");

  // More than one Session this attempt could plausibly use. Returning either
  // would leave the other completable.
  if (own.length + legacy.length > 1) {
    captureMessage("billing.session_ambiguous", "error", {
      fields: { userId: args.userId, sessionCount: own.length + legacy.length },
    });
    return { kind: "refuse", outcome: { kind: "unavailable" } };
  }

  const ours = own[0];
  if (ours) return { kind: "reuse", session: ours.session };

  const stale = legacy[0];
  if (stale) {
    // Pre-fix Session: we cannot reconstruct the request that created it, so it
    // can never be replayed safely. Expiring costs the user a page reload and
    // keeps the one-live-Session invariant intact.
    const confirmed = await expireAndConfirm(stripe, stale.session.id);
    if (!confirmed) {
      captureMessage("billing.session_expire_unconfirmed", "error", {
        fields: { userId: args.userId, attemptId: attempt.id },
      });
      return { kind: "refuse", outcome: { kind: "unavailable" } };
    }
  }

  return { kind: "create" };
}

/**
 * Creates or replays the Session from the immutable snapshot.
 *
 * The same idempotency key is used on every call for this attempt, so a lost
 * response, a crash, or a takeover all recover the original Session rather than
 * creating a second one.
 */
async function createOrReplay(
  stripe: Stripe,
  attempt: CheckoutAttempt,
): Promise<
  { kind: "ok"; session: Stripe.Checkout.Session } | { kind: "in_use" } | { kind: "failed" }
> {
  try {
    const session = await stripe.checkout.sessions.create(buildSessionRequest(attempt), {
      idempotencyKey: sessionIdempotencyKey(attempt),
    });
    return { kind: "ok", session };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    // Another processor is mid-flight under the same key. Never a new key.
    if (code === "idempotency_key_in_use") return { kind: "in_use" };
    return { kind: "failed" };
  }
}

export type FlowArgs = {
  userId: string;
  /** Allowed to claim a brand-new attempt. `continue` never is. */
  mayClaim: boolean;
  /** Charges the rate limit; called only when a genuinely new attempt is claimed. */
  onNewAttempt?: () => Promise<CheckoutOutcome | null>;
  appUrl: string;
  now?: Date;
};

/**
 * The single entry point shared by POST /checkout and GET /checkout/continue.
 */
export async function runCheckoutFlow(args: FlowArgs): Promise<CheckoutOutcome> {
  const now = args.now ?? new Date();
  const stripe = getStripe();
  const priceId = plusPriceId();

  if (!stripe || !isBillingConfigured() || !priceId) return { kind: "unavailable" };

  const subscription = await prisma.subscription.findUnique({
    where: { userId: args.userId },
    select: { stripeCustomerId: true, billingBlockedReason: true, plan: true, status: true },
  });

  if (subscription?.billingBlockedReason) {
    return { kind: "blocked", message: BLOCKED_MESSAGE };
  }

  // Cheap local pre-check. An optimization only — never authoritative, because
  // this row is precisely what is stale while a webhook is in flight.
  if (subscription?.plan === "PLUS" && ["ACTIVE", "TRIALING"].includes(subscription.status)) {
    return { kind: "conflict", message: ALREADY_SUBSCRIBED };
  }

  let attempt = await liveAttemptForUser(args.userId);

  if (!attempt) {
    if (!args.mayClaim) return { kind: "conflict", message: IN_FLIGHT };

    const limited = args.onNewAttempt ? await args.onNewAttempt() : null;
    if (limited) return limited;

    const claim = await claimAttempt({ userId: args.userId, priceId, appUrl: args.appUrl, now });
    attempt = claim.attempt;
    if (claim.kind === "exists" && attempt.status === "PENDING" && !leaseHasLapsed(attempt, now)) {
      return { kind: "conflict", message: IN_FLIGHT, retryAfterSeconds: 2 };
    }
  }

  if (attempt.status === "COMPLETED") {
    return { kind: "conflict", message: ALREADY_SUBSCRIBED };
  }

  // Another process is actively working this attempt.
  if (attempt.status === "PENDING" && !leaseHasLapsed(attempt, now) && !args.mayClaim) {
    return { kind: "conflict", message: IN_FLIGHT, retryAfterSeconds: 2 };
  }
  if (attempt.status === "PENDING") {
    attempt = await takeOverLease(attempt.id, now);
  }

  // --- customer -----------------------------------------------------------
  let customerId = attempt.stripeCustomerId ?? subscription?.stripeCustomerId ?? null;
  if (!customerId) {
    const resolved = await resolveCustomer({
      stripe,
      userId: args.userId,
      customerIdemKey: attempt.customerIdemKey,
      existingCustomerId: null,
    });

    if (resolved.kind === "unavailable") return { kind: "unavailable" };
    if (resolved.kind === "blocked") {
      await blockBilling(args.userId, resolved.reason);
      return { kind: "blocked", message: BLOCKED_MESSAGE };
    }

    customerId = resolved.customerId;
    // Persisted before any Session exists, so a webhook can always map back.
    await persistCustomerMapping(args.userId, customerId);
    attempt = await recordCustomer(attempt.id, customerId);
  } else if (!attempt.stripeCustomerId) {
    attempt = await recordCustomer(attempt.id, customerId);
  }

  // --- authoritative subscription check -----------------------------------
  const refusal = await refuseIfSubscribed(stripe, attempt, {
    userId: args.userId,
    customerId,
    priceId,
  });
  if (refusal) return refusal;

  // --- session ------------------------------------------------------------
  const resolution = await resolveSession(stripe, attempt, {
    userId: args.userId,
    customerId,
    priceId,
    now,
  });
  if (resolution.kind === "refuse") return resolution.outcome;

  if (resolution.kind === "reuse") {
    const url = resolution.session.url;
    if (!url) return { kind: "unavailable" };
    return { kind: "session", url };
  }

  const created = await createOrReplay(stripe, attempt);
  if (created.kind === "in_use") {
    return { kind: "conflict", message: IN_FLIGHT, retryAfterSeconds: 2 };
  }
  if (created.kind === "failed") return { kind: "unavailable" };

  const session = created.session;

  // A replay can return a Session that is no longer open. It must never be
  // treated as OPEN just because the call succeeded.
  if (session.status === "complete") {
    await terminalizeAttempt(attempt.id, "COMPLETED");
    return { kind: "conflict", message: ALREADY_SUBSCRIBED };
  }
  if (session.status === "expired") {
    await terminalizeAttempt(attempt.id, "EXPIRED");
    return { kind: "conflict", message: IN_FLIGHT, retryAfterSeconds: 2 };
  }
  if (session.status !== "open" || !session.url) {
    captureMessage("billing.session_unexpected_shape", "error", {
      fields: { userId: args.userId, attemptId: attempt.id },
    });
    await terminalizeAttempt(attempt.id, "FAILED");
    return { kind: "unavailable" };
  }

  await recordSession(
    attempt.id,
    session.id,
    session.expires_at ? new Date(session.expires_at * 1000) : null,
  );

  logger.info("billing.attempt_opened", { userId: args.userId, attemptId: attempt.id });
  return { kind: "session", url: session.url };
}
