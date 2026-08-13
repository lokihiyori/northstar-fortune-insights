import type Stripe from "stripe";
import { NextResponse } from "next/server";

import { getStripe, expectedLivemode, plusPriceId, webhookSecret } from "@/features/billing/stripe";
import {
  deriveProjection,
  fetchMatchingSubscriptions,
  lockCustomer,
  recordReconcileFailure,
  writeProjection,
} from "@/features/billing/reconcile";
import { expireAndConfirm } from "@/features/billing/session-discovery";
import { recordEvent } from "@/features/analytics/events";
import { prisma } from "@/lib/db/prisma";
import { withApiLogging } from "@/lib/observability/handler";
import { logFailure } from "@/lib/observability/logger";
import { captureException, captureMessage } from "@/lib/observability/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook.
 *
 * Properties this endpoint must have:
 *
 *  1. The signature is verified before the body is parsed. An unverified body is
 *     attacker-controlled and must never reach application logic.
 *  2. Processing is idempotent. Stripe delivers at least once, so every event id
 *     is recorded and a replay is a no-op. The claim is inserted *inside* the
 *     transaction that does the work, so two simultaneous deliveries of one
 *     event cannot both pass a read-then-write check.
 *  3. **Entitlement is derived from Stripe's current set, never from the event.**
 *     The payload identifies the customer and may complete an attempt; nothing
 *     else about it reaches the projection. Combined with a per-customer
 *     advisory lock taken before the Stripe read, that makes the outcome
 *     independent of delivery order.
 *  4. It never grants access from a client redirect — only from these events.
 */

const HANDLED = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

const TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 };

export const POST = withApiLogging("/api/v1/webhooks/stripe", async (request: Request) => {
  const stripe = getStripe();
  const secret = webhookSecret();
  const priceId = plusPriceId();

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

  // Mode is a property of the configured key, never of NODE_ENV. A wrong-mode
  // event is a permanent condition — retrying cannot fix crossed keys — so it is
  // acknowledged loudly rather than retried forever.
  if (event.livemode !== expectedLivemode()) {
    captureMessage("billing.mode_mismatch", "error", { fields: { eventType: event.type } });
    return NextResponse.json({ received: true, ignored: "mode" });
  }

  if (!HANDLED.has(event.type)) {
    // Recorded as processed so Stripe stops retrying something deliberately
    // ignored.
    await prisma.processedWebhookEvent
      .create({ data: { id: event.id, type: event.type } })
      .catch(() => undefined);
    return NextResponse.json({ received: true });
  }

  const subscription = event.data.object as Stripe.Subscription;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const local = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { userId: true },
  });

  if (!local) {
    return unmappedCustomer(event, subscription, priceId);
  }

  const metadataUserId = subscription.metadata?.["userId"];
  if (metadataUserId !== undefined && metadataUserId !== local.userId) {
    // Cross-linked metadata is a data-integrity incident, not a transient
    // fault. Retrying cannot repair it, so it is acknowledged and escalated
    // without touching entitlement.
    captureMessage("billing.cross_linked_metadata", "error", {
      fields: { userId: local.userId, eventType: event.type },
    });
    return NextResponse.json({ received: true, ignored: "cross_linked" });
  }

  if (!priceId) return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Serializes every reconciliation for this customer. Taken before the
      // Stripe read so two different event ids cannot both act on state the
      // other is about to invalidate.
      await lockCustomer(tx, customerId);

      try {
        await tx.processedWebhookEvent.create({ data: { id: event.id, type: event.type } });
      } catch (error) {
        if (isUniqueViolation(error)) return { kind: "duplicate" as const };
        throw error;
      }

      const fetched = await fetchMatchingSubscriptions(stripe, {
        customerId,
        userId: local.userId,
        priceId,
      });

      // A truncated view must never become a projection, and the event must stay
      // retryable — so this throws to roll the whole transaction back.
      if (fetched.kind === "incomplete") throw new IncompleteReadError();

      const projection = deriveProjection({ matching: fetched.matching });
      await writeProjection(tx, local.userId, projection, new Date());

      return { kind: "reconciled" as const, projection };
    }, TX_OPTIONS);

    if (result.kind === "duplicate") {
      return NextResponse.json({ received: true, duplicate: true });
    }

    // Outside the transaction: completing the attempt may require expiring a
    // Stripe Session, and a remote call that cannot be rolled back does not
    // belong inside a database transaction.
    await completeAttempt(stripe, subscription, local.userId);

    if (result.projection.plan === "PLUS" && event.type === "customer.subscription.created") {
      await recordEvent("subscription_activated", null, { plan: "plus" });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    // Not recorded as processed, so Stripe's retry will run it again. The
    // failure metadata is written in its own short transaction because anything
    // written inside the rolled-back one would have rolled back with it.
    await recordReconcileFailure(local.userId);

    logFailure("webhook.processing_failed", "internal", {
      eventType: event.type,
      eventId: event.id,
    });
    captureException(error, { category: "internal", fields: { eventType: event.type } });
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
});

class IncompleteReadError extends Error {
  override readonly name = "IncompleteReadError";
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * An event whose customer has no local mapping.
 *
 * Distinguished rather than blanket-acknowledged: silently returning 200 for
 * everything would permanently lose a reconciliation whenever a mapping write
 * raced the webhook. An event that looks like ours is retried; an unrelated one
 * is acknowledged.
 */
function unmappedCustomer(
  event: Stripe.Event,
  subscription: Stripe.Subscription,
  priceId: string | null,
): NextResponse {
  const carriesOurMetadata =
    subscription.metadata?.["userId"] !== undefined ||
    subscription.metadata?.["attemptId"] !== undefined;
  const carriesOurPrice =
    priceId !== null && subscription.items.data.some((item) => item.price.id === priceId);

  if (carriesOurMetadata || carriesOurPrice) {
    captureMessage("billing.unmapped_customer_event", "error", {
      fields: { eventType: event.type },
    });
    return NextResponse.json({ error: "Customer mapping unavailable." }, { status: 500 });
  }

  return NextResponse.json({ received: true, ignored: "unrelated" });
}

/**
 * Terminalizes the attempt this subscription came from.
 *
 * Only an attempt that names itself in the subscription's metadata is touched.
 * An event with no attempt id completes nothing — falling back to "the user's
 * current attempt" is precisely how an unrelated in-flight attempt would be
 * closed.
 *
 * If a *different* Session is still open, it is expired and confirmed before the
 * claim is released. Marking the attempt COMPLETED while leaving a usable
 * Checkout URL in the user's browser is what produced the duplicates in D1.
 */
async function completeAttempt(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  userId: string,
): Promise<void> {
  const attemptId = subscription.metadata?.["attemptId"];
  if (!attemptId) return;

  const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt) {
    captureMessage("billing.attempt_mismatch", "error", { fields: { userId } });
    return;
  }

  if (attempt.userId !== userId) {
    captureMessage("billing.attempt_mismatch", "error", { fields: { userId } });
    return;
  }

  // Terminal is terminal: a replayed or out-of-order event must not reopen an
  // attempt or replace a completed one.
  if (attempt.status !== "PENDING" && attempt.status !== "OPEN") return;

  if (attempt.stripeSessionId) {
    // Check before acting. The Session that produced this subscription is
    // already `complete`, and calling expire on it would fail — which must not
    // be mistaken for "a live Session I could not kill".
    let stillOpen: boolean;
    try {
      const session = await stripe.checkout.sessions.retrieve(attempt.stripeSessionId);
      stillOpen = session.status === "open";
    } catch {
      // Cannot prove it is closed, so do not release the claim.
      captureMessage("billing.session_expire_unconfirmed", "error", {
        fields: { userId, attemptId: attempt.id },
      });
      return;
    }

    if (stillOpen) {
      // A *different* Session produced the subscription and this one is still
      // completable. Releasing the claim now would let the user buy twice.
      const confirmed = await expireAndConfirm(stripe, attempt.stripeSessionId);
      if (!confirmed) {
        captureMessage("billing.session_expire_unconfirmed", "error", {
          fields: { userId, attemptId: attempt.id },
        });
        return;
      }
    }
  }

  await prisma.checkoutAttempt.updateMany({
    where: { id: attempt.id, status: { in: ["PENDING", "OPEN"] } },
    data: { status: "COMPLETED", activeForUserId: null },
  });
}
