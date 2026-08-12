import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { SubscriptionPlan, SubscriptionStatus } from "@/generated/prisma/enums";

/**
 * The local projection of Stripe's state.
 *
 * Entitlements are derived from this row, never from a client redirect and
 * never by calling Stripe on the request path (spec section 13). Stripe remains
 * the authority on payment; this is the authority on access.
 */

/** Statuses that grant paid access. Anything else falls back to Free. */
const ENTITLED: readonly SubscriptionStatus[] = ["ACTIVE", "TRIALING"];

export async function getSubscription(userId: string) {
  return prisma.subscription.findUnique({
    where: { userId },
    select: {
      plan: true,
      status: true,
      stripeStatusRaw: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      stripeCustomerId: true,
      entitledCount: true,
      matchingBlockingCount: true,
      reconciledAt: true,
      billingBlockedReason: true,
    },
  });
}

/**
 * Entitlement, derived from the reconciled projection.
 *
 * `entitledCount` is authoritative once a live reconciliation has happened: it
 * counts the matching subscriptions Stripe currently reports as `active` or
 * `trialing`, so one subscription being cancelled while another remains does not
 * revoke access. Rows that predate the fix have `reconciledAt === null` and fall
 * back to the original plan/status rule, which the migration backfill made
 * agree with the counts for every legacy shape.
 */
export async function effectivePlan(userId: string): Promise<"free" | "plus"> {
  const subscription = await getSubscription(userId);
  if (!subscription) return "free";

  if (subscription.reconciledAt !== null) {
    return subscription.entitledCount >= 1 ? "plus" : "free";
  }

  const entitled = subscription.plan === "PLUS" && ENTITLED.includes(subscription.status);
  return entitled ? "plus" : "free";
}

/**
 * Applies a Stripe subscription state to the local projection.
 *
 * Keyed on the Stripe customer id so it is safe to call repeatedly with the same
 * event — webhook delivery is at-least-once.
 */
export async function applySubscriptionState(args: {
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}): Promise<boolean> {
  const existing = await prisma.subscription.findUnique({
    where: { stripeCustomerId: args.stripeCustomerId },
    select: { id: true },
  });

  // An event for a customer we have no record of is ignored rather than
  // guessed at — attaching it to the wrong account would be worse.
  if (!existing) return false;

  await prisma.subscription.update({
    where: { id: existing.id },
    data: {
      stripeSubscriptionId: args.stripeSubscriptionId,
      stripePriceId: args.stripePriceId,
      plan: args.plan,
      status: args.status,
      currentPeriodEnd: args.currentPeriodEnd,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
    },
  });

  return true;
}

/** Ensures a row exists before a Checkout session, so the webhook can find it. */
export async function linkStripeCustomer(userId: string, stripeCustomerId: string): Promise<void> {
  await prisma.subscription.upsert({
    where: { userId },
    update: { stripeCustomerId },
    create: { userId, stripeCustomerId, plan: "FREE", status: "ACTIVE" },
  });
}

export function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "unpaid":
      return "UNPAID";
    default:
      return "INCOMPLETE";
  }
}
