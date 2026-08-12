import "server-only";

import type Stripe from "stripe";
import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/observability/logger";
import { captureMessage } from "@/lib/observability/monitoring";
import { expectedLivemode } from "./stripe";
import { deriveProjection, type MatchedSubscription, type Projection } from "./subscription-set";

/**
 * Deriving the local projection from Stripe's current subscription set.
 *
 * **No event's payload ever reaches the projection.** The triggering event is
 * used only to identify the customer and to complete an attempt; plan, status,
 * period, and canonical id are computed from a fresh `subscriptions.list` read
 * taken while holding a per-customer lock. That is what makes the outcome
 * independent of delivery order — the D2 fix.
 */

const MAX_PAGES = 5;
const PAGE_SIZE = 100;

/**
 * Serializes every reconciliation for one customer.
 *
 * Taken **before** the Stripe read, so two handlers cannot both observe state
 * that the other is about to invalidate. Without it, `ProcessedWebhookEvent`
 * deduplicates one event id but does nothing for two different ids touching the
 * same customer, and the slower handler's older snapshot lands last.
 *
 * The key is hashed inside PostgreSQL from a bound parameter — the customer id
 * is never interpolated into SQL. A hash collision between two customers costs
 * only unnecessary serialization: the lock guards nothing but ordering, and each
 * transaction still reads and writes its own customer's rows.
 */
export async function lockCustomer(
  tx: Prisma.TransactionClient,
  customerId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${customerId}, 0))`;
}

export type MatchArgs = { customerId: string; userId: string; priceId: string };

/**
 * Which subscriptions count.
 *
 * A subscription grants nothing unless it is unambiguously this product's, for
 * this customer, at the server-owned Price. Everything else is ignored for
 * entitlement — an unrelated Price must never grant PLUS.
 */
export function matches(subscription: Stripe.Subscription, args: MatchArgs): boolean {
  if (subscription.livemode !== expectedLivemode()) return false;

  const customer =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  if (customer !== args.customerId) return false;

  const items = subscription.items.data;
  if (items.length !== 1) return false;

  const item = items[0];
  if (!item || item.price.id !== args.priceId) return false;
  if (item.price.type !== "recurring") return false;

  // Metadata corroborates identity; it does not establish it. Subscriptions
  // created before this fix carry none, and rejecting those would strand every
  // existing customer. A *mismatch*, however, means cross-linking.
  const metadataUserId = subscription.metadata?.["userId"];
  if (metadataUserId !== undefined && metadataUserId !== args.userId) return false;

  return true;
}

export function toMatched(subscription: Stripe.Subscription): MatchedSubscription {
  const item = subscription.items.data[0];
  const periodEnd = item?.current_period_end ?? null;

  return {
    id: subscription.id,
    statusRaw: subscription.status,
    created: subscription.created,
    currentPeriodEnd: periodEnd === null ? null : new Date(periodEnd * 1000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    priceId: item?.price.id ?? "",
  };
}

export type FetchResult =
  | { kind: "ok"; matching: MatchedSubscription[]; crossLinked: number }
  /** Pagination bound hit or Stripe unavailable. Never reconcile from this. */
  | { kind: "incomplete" };

/**
 * Reads the customer's complete subscription set.
 *
 * `status: "all"` is required, not incidental: filtering to `active` server-side
 * would hide `past_due`, `unpaid`, `paused`, and `trialing`, and those are
 * exactly the states that must block a second subscription.
 */
export async function fetchMatchingSubscriptions(
  stripe: Stripe,
  args: MatchArgs,
): Promise<FetchResult> {
  const matching: MatchedSubscription[] = [];
  let crossLinked = 0;
  let startingAfter: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let batch: Stripe.ApiList<Stripe.Subscription>;
    try {
      batch = await stripe.subscriptions.list({
        customer: args.customerId,
        status: "all",
        limit: PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
    } catch {
      return { kind: "incomplete" };
    }

    for (const subscription of batch.data) {
      const metadataUserId = subscription.metadata?.["userId"];
      if (metadataUserId !== undefined && metadataUserId !== args.userId) crossLinked += 1;
      if (matches(subscription, args)) matching.push(toMatched(subscription));
    }

    if (!batch.has_more) return { kind: "ok", matching, crossLinked };

    // See session-discovery: an unadvanceable cursor with more pages is a
    // truncated view, never a complete one.
    startingAfter = batch.data.at(-1)?.id;
    if (!startingAfter) return { kind: "incomplete" };
  }

  return { kind: "incomplete" };
}

/**
 * Writes the derived projection.
 *
 * Runs inside the caller's transaction, after the lock and the Stripe read, so
 * the projection and the `ProcessedWebhookEvent` row commit together.
 */
export async function writeProjection(
  tx: Prisma.TransactionClient,
  userId: string,
  projection: Projection,
  now: Date,
): Promise<void> {
  await tx.subscription.update({
    where: { userId },
    data: {
      plan: projection.plan,
      status: projection.status,
      stripeStatusRaw: projection.statusRaw,
      stripeSubscriptionId: projection.canonicalId,
      stripePriceId: projection.priceId,
      currentPeriodEnd: projection.currentPeriodEnd,
      cancelAtPeriodEnd: projection.cancelAtPeriodEnd,
      entitledCount: projection.entitledCount,
      matchingBlockingCount: projection.matchingBlockingCount,
      reconciledAt: now,
      reconcileFailureCount: 0,
      reconcileFailedAt: null,
    },
  });

  if (projection.duplicateRisk) {
    captureMessage("billing.duplicate_active_subscriptions", "error", {
      fields: {
        userId,
        entitledCount: projection.entitledCount,
        matchingBlockingCount: projection.matchingBlockingCount,
      },
    });
  }
}

export { deriveProjection };

/**
 * Records a reconciliation failure **outside** the transaction that rolled back.
 *
 * Best-effort and non-correctness: anything written inside the failed
 * transaction would have rolled back with it, so an earlier design that
 * incremented these columns there recorded nothing at all. If this also fails
 * the caller still returns its original retryable error — the event is never
 * marked processed.
 */
export async function recordReconcileFailure(userId: string): Promise<void> {
  try {
    await prisma.subscription.update({
      where: { userId },
      data: { reconcileFailureCount: { increment: 1 }, reconcileFailedAt: new Date() },
    });
  } catch {
    logger.warn("billing.reconcile_failure_unrecorded", { userId });
  }
}
