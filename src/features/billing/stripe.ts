import "server-only";

import Stripe from "stripe";

import { expectedLivemode as expectedLivemodeFor, resolveStripeMode } from "./mode";

/**
 * Stripe access, behind a nullable accessor.
 *
 * Billing is optional infrastructure: without keys the product must still run,
 * with the upgrade path disabled rather than crashing. Every caller handles the
 * null case explicitly, which is also what makes the whole app demonstrable and
 * testable with no Stripe account.
 *
 * **The API version is pinned.** Reconciliation depends on the shape of
 * `subscriptions.list` and on subscription item fields; letting the account
 * default drift would change those semantics without a code change.
 */
const STRIPE_API_VERSION = "2026-07-29.dahlia" satisfies Stripe.LatestApiVersion;

let cached: Stripe | null | undefined;

/**
 * Test seam.
 *
 * Set by integration tests to inject a fake at the external boundary. Nothing in
 * `src` calls this. It exists because the correctness properties being tested —
 * one Customer and one Session under concurrency, recovery after a lost
 * response — cannot be observed without counting calls, and must not require
 * real credentials in CI.
 */
let override: Stripe | null | undefined;

export function setStripeClientForTests(client: Stripe | null | undefined): void {
  override = client;
  cached = undefined;
}

export function getStripe(): Stripe | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;

  const key = process.env.STRIPE_SECRET_KEY;
  cached = key ? new Stripe(key, { apiVersion: STRIPE_API_VERSION }) : null;
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

/** The mode implied by the configured key. Never derived from NODE_ENV. */
export function stripeMode(): "test" | "live" {
  return resolveStripeMode();
}

/** The `livemode` value every Stripe object and event must carry. */
export function expectedLivemode(): boolean {
  return expectedLivemodeFor();
}

export { STRIPE_API_VERSION };
