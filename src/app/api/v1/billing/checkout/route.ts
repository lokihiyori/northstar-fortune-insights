import { requireApiUser } from "@/features/auth/guards";
import { apiError, apiSuccess } from "@/lib/api/response";
import { getStripe, isBillingConfigured, plusPriceId } from "@/features/billing/stripe";
import { getSubscription, linkStripeCustomer } from "@/features/billing/subscription";
import { recordEvent } from "@/features/analytics/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Creates a Stripe Checkout session using a server-owned price id.
 *
 * The client never sends a price, an amount, or a plan — only the intent to
 * upgrade. Nothing here grants access; that happens only when the webhook
 * arrives (spec section 13).
 */
export async function POST() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const stripe = getStripe();
  const priceId = plusPriceId();

  if (!stripe || !isBillingConfigured() || !priceId) {
    return apiError("INTERNAL", "Billing is not configured on this deployment.", { status: 503 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const existing = await getSubscription(auth.user.id);

    // Reuse the customer so a returning user does not accumulate duplicates.
    const customerId =
      existing?.stripeCustomerId ??
      (
        await stripe.customers.create({
          email: auth.user.email,
          metadata: { userId: auth.user.id },
        })
      ).id;

    // Persisted before Checkout so the webhook can resolve the customer to a
    // user even if the browser never returns.
    await linkStripeCustomer(auth.user.id, customerId);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/app/billing?checkout=success`,
      cancel_url: `${appUrl}/app/billing?checkout=cancelled`,
      // Echoed back on the webhook as a second way to identify the account.
      subscription_data: { metadata: { userId: auth.user.id } },
      allow_promotion_codes: true,
    });

    await recordEvent("upgrade_started", auth.user.id, { plan: "plus" });

    if (!session.url) {
      return apiError("INTERNAL", "Stripe did not return a checkout URL.");
    }

    return apiSuccess({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout failed:", error);
    return apiError("INTERNAL", "We could not start checkout. Please try again.");
  }
}
