import "server-only";

import type Stripe from "stripe";

import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/observability/logger";
import { captureMessage } from "@/lib/observability/monitoring";
import { expectedLivemode } from "./stripe";

/**
 * Resolving the user's single Stripe Customer, failing closed on ambiguity.
 *
 * Only the holder of the per-user Checkout claim calls this, so there is exactly
 * one writer. Ordering matters:
 *
 *  1. **Local mapping** — the normal path.
 *  2. **Idempotent re-create** using the attempt's persisted opaque key. Within
 *     Stripe's 24-hour retention this returns the *original* Customer, which is
 *     an exact read-after-write. Stripe documents Search as eventually
 *     consistent and unsuitable for read-after-write, so it cannot go here.
 *  3. **Search**, only once the key may have aged out and any index lag is long
 *     past. Requires complete pagination; any error refuses rather than creates.
 *
 * More than one Customer for a user disables billing until an operator
 * intervenes. Probing subscriptions on one arbitrarily chosen Customer could
 * create a new subscription while another Customer already holds one.
 */

const MAX_SEARCH_PAGES = 5;

export type CustomerResolution =
  | { kind: "ok"; customerId: string }
  /** Ambiguous or unverifiable. Billing must refuse; never guess. */
  | { kind: "blocked"; reason: "duplicate_customer" }
  /** Stripe could not answer. Retryable; nothing was created. */
  | { kind: "unavailable" };

function livemodeOk(customer: Stripe.Customer | Stripe.DeletedCustomer): boolean {
  return "livemode" in customer && customer.livemode === expectedLivemode();
}

/**
 * Exact metadata search across every page.
 *
 * Partial pagination is treated as failure: "zero results" from a truncated
 * search is indistinguishable from "no Customer exists", and acting on it would
 * create a duplicate.
 */
async function searchByUserId(
  stripe: Stripe,
  userId: string,
): Promise<{ kind: "ok"; customers: Stripe.Customer[] } | { kind: "unavailable" }> {
  const found: Stripe.Customer[] = [];
  let page: string | undefined;

  for (let i = 0; i < MAX_SEARCH_PAGES; i += 1) {
    let batch: Stripe.ApiSearchResult<Stripe.Customer>;
    try {
      batch = await stripe.customers.search({
        query: `metadata['userId']:'${userId}'`,
        limit: 100,
        ...(page ? { page } : {}),
      });
    } catch {
      return { kind: "unavailable" };
    }

    for (const customer of batch.data) {
      // `customers.search` returns live Customers only, but a deleted one would
      // have no metadata to match anyway.
      if ("deleted" in customer && customer.deleted) continue;
      if (!livemodeOk(customer)) continue;
      if (customer.metadata?.["userId"] !== userId) continue;
      found.push(customer);
    }

    if (!batch.has_more || !batch.next_page) return { kind: "ok", customers: found };
    page = batch.next_page;
  }

  return { kind: "unavailable" };
}

export type ResolveArgs = {
  stripe: Stripe;
  userId: string;
  /** Persisted opaque per-attempt key. Never derived from the user id. */
  customerIdemKey: string;
  /** The mapping already stored locally, if any. */
  existingCustomerId: string | null;
};

export async function resolveCustomer(args: ResolveArgs): Promise<CustomerResolution> {
  // 1. Local mapping.
  if (args.existingCustomerId) return { kind: "ok", customerId: args.existingCustomerId };

  // 2. Idempotent create. Inside the retention window this is a read-after-write
  //    for a Customer a previous attempt created but failed to persist.
  let created: Stripe.Customer;
  try {
    created = await args.stripe.customers.create(
      { metadata: { userId: args.userId } },
      { idempotencyKey: args.customerIdemKey },
    );
  } catch {
    // 3. Key aged out, or the create failed. Search is the only remaining way to
    //    discover a Customer we may already own.
    const search = await searchByUserId(args.stripe, args.userId);
    if (search.kind === "unavailable") return { kind: "unavailable" };

    if (search.customers.length > 1) {
      captureMessage("billing.duplicate_customer", "error", {
        fields: { userId: args.userId, customerCount: search.customers.length },
      });
      return { kind: "blocked", reason: "duplicate_customer" };
    }

    const only = search.customers[0];
    if (only) return { kind: "ok", customerId: only.id };

    return { kind: "unavailable" };
  }

  if (!livemodeOk(created)) {
    captureMessage("billing.mode_mismatch", "error", { fields: { objectType: "customer" } });
    return { kind: "unavailable" };
  }

  return { kind: "ok", customerId: created.id };
}

/**
 * Persists the mapping **before** any Checkout Session is created, so a webhook
 * can always resolve the Customer back to a user even if the browser never
 * returns.
 */
export async function persistCustomerMapping(userId: string, customerId: string): Promise<void> {
  await prisma.subscription.upsert({
    where: { userId },
    update: { stripeCustomerId: customerId },
    create: { userId, stripeCustomerId: customerId, plan: "FREE", status: "ACTIVE" },
  });
}

/** Records that billing must not proceed until an operator has looked. */
export async function blockBilling(userId: string, reason: string): Promise<void> {
  logger.error("billing.blocked", { userId, blockedReason: reason });
  await prisma.subscription.upsert({
    where: { userId },
    update: { billingBlockedReason: reason },
    create: { userId, billingBlockedReason: reason, plan: "FREE", status: "ACTIVE" },
  });
}
