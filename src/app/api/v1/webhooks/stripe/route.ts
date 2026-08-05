import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { getStripe, webhookSecret } from "@/features/billing/stripe";
import { applySubscriptionState, mapStripeStatus } from "@/features/billing/subscription";
import { recordEvent } from "@/features/analytics/events";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook.
 *
 * Three properties this endpoint must have (spec section 13):
 *   1. The signature is verified before the body is parsed. An unverified body
 *      is attacker-controlled and must never reach application logic.
 *   2. Processing is idempotent. Stripe delivers at least once, so every event
 *      id is recorded and a replay is a no-op.
 *   3. It never grants access from a client redirect — only from these events.
 *
 * Always returns 200 once handled, so Stripe stops retrying. Failures are
 * logged and surfaced as 500 so Stripe *does* retry.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = webhookSecret();

  if (!stripe || !secret) {
    // Nothing is configured, so nothing can be verified. Refuse rather than
    // accept an unverifiable payload.
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  // The raw body is required: any re-serialisation invalidates the signature.
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // Idempotency: a duplicate delivery is acknowledged without reprocessing.
  const seen = await prisma.processedWebhookEvent.findUnique({
    where: { id: event.id },
    select: { id: true },
  });
  if (seen) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(event);

    await prisma.processedWebhookEvent.create({
      data: { id: event.id, type: event.type },
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    // Not recorded as processed, so Stripe's retry will run it again.
    console.error(`Stripe webhook ${event.type} (${event.id}) failed:`, error);
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;

      const item = subscription.items.data[0];
      const status = mapStripeStatus(subscription.status);

      // A deleted or lapsed subscription drops the account back to Free.
      const entitled = status === "ACTIVE" || status === "TRIALING";

      const applied = await applySubscriptionState({
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
        stripePriceId: item?.price.id ?? null,
        plan: entitled && event.type !== "customer.subscription.deleted" ? "PLUS" : "FREE",
        status: event.type === "customer.subscription.deleted" ? "CANCELED" : status,
        currentPeriodEnd: item?.current_period_end
          ? new Date(item.current_period_end * 1000)
          : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      });

      if (applied && entitled && event.type === "customer.subscription.created") {
        await recordEvent("subscription_activated", null, { plan: "plus" });
      }
      return;
    }

    default:
      // Unhandled types are still recorded as processed so Stripe stops
      // retrying something we have deliberately ignored.
      return;
  }
}
