import { requireApiUser } from "@/features/auth/guards";
import { assertNotDemo } from "@/features/demo/session";
import { apiError, apiSuccess } from "@/lib/api/response";
import { getStripe, isBillingConfigured } from "@/features/billing/stripe";
import { getSubscription } from "@/features/billing/subscription";
import { setContextActor } from "@/lib/observability/context";
import { withApiLogging } from "@/lib/observability/handler";
import { logFailure } from "@/lib/observability/logger";
import { captureException } from "@/lib/observability/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Customer Portal session so cancellation and card changes stay with Stripe. */
export const POST = withApiLogging("/api/v1/billing/portal", async () => {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  setContextActor(auth.user.id);

  // Same rule as Checkout, and checked against the database for the same
  // reason: this denies an action, so a token claim is not evidence.
  const notDemo = await assertNotDemo(auth.user.id, "Billing");
  if (!notDemo.ok) return notDemo.response;

  const stripe = getStripe();
  if (!stripe || !isBillingConfigured()) {
    return apiError("INTERNAL", "Billing is not configured on this deployment.", { status: 503 });
  }

  const subscription = await getSubscription(auth.user.id);
  if (!subscription?.stripeCustomerId) {
    return apiError("NOT_FOUND", "There is no billing account to manage yet.");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${appUrl}/app/billing`,
    });

    return apiSuccess({ url: session.url });
  } catch (error) {
    logFailure("billing.request_failed", "dependency_unavailable", { operation: "portal" });
    captureException(error, { category: "dependency_unavailable" });
    return apiError("INTERNAL", "We could not open the billing portal.");
  }
});
