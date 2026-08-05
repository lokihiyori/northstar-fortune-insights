import "server-only";

import Stripe from "stripe";

/**
 * Stripe access, behind a nullable accessor.
 *
 * Billing is optional infrastructure: without keys the product must still run,
 * with the upgrade path disabled rather than crashing. Every caller handles the
 * null case explicitly, which is also what makes the whole app demonstrable and
 * testable with no Stripe account.
 */
let cached: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;

  const key = process.env.STRIPE_SECRET_KEY;
  cached = key ? new Stripe(key) : null;
  return cached;
}

export function isBillingConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_PLUS_PRICE_ID &&
    process.env.STRIPE_WEBHOOK_SECRET,
  );
}

/** Server-owned. A price id from the client is never trusted (CLAUDE.md). */
export function plusPriceId(): string | null {
  return process.env.STRIPE_PLUS_PRICE_ID ?? null;
}

export function webhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET ?? null;
}
