import { requireApiUser } from "@/features/auth/guards";
import { assertNotDemo } from "@/features/demo/session";
import { apiError, apiSuccess } from "@/lib/api/response";
import { isBillingConfigured } from "@/features/billing/stripe";
import { runCheckoutFlow, type CheckoutOutcome } from "@/features/billing/checkout-flow";
import { recordEvent } from "@/features/analytics/events";
import {
  rateLimitResponse,
  releaseReservation,
  reserve,
  type Reservation,
} from "@/lib/rate-limit/enforce";
import { setContextActor } from "@/lib/observability/context";
import { withApiLogging } from "@/lib/observability/handler";
import { logFailure } from "@/lib/observability/logger";
import { captureException } from "@/lib/observability/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prepares a Stripe Checkout Session using a server-owned price id.
 *
 * The client sends no body at all — not a price, not an amount, not a plan — so
 * a client-supplied price is structurally impossible.
 *
 * **This endpoint does not return the Checkout URL.** The URL is bearer-like: it
 * completes a payment for whoever holds it. It is never persisted, never logged,
 * and never placed in a JSON body that client-side code could copy into
 * analytics or an error report. The browser is sent to `continue`, which fetches
 * the Session server-side, revalidates it, and redirects.
 */
export const POST = withApiLogging("/api/v1/billing/checkout", async () => {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  setContextActor(auth.user.id);

  // Database-backed, not session-derived: this denies an action, so the token is
  // not good enough. A shared recruiter login must never reach Stripe.
  const notDemo = await assertNotDemo(auth.user.id, "Billing");
  if (!notDemo.ok) return notDemo.response;

  if (!isBillingConfigured()) {
    return apiError("INTERNAL", "Billing is not configured on this deployment.", { status: 503 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  /**
   * Request-scoped. Never a module-level variable: that is shared across
   * concurrent requests and would let one request release another's unit.
   */
  let held: Reservation | null = null;
  let refusal: ReturnType<typeof rateLimitResponse> = null;

  try {
    const outcome = await runCheckoutFlow({
      userId: auth.user.id,
      mayClaim: true,
      appUrl,
      /**
       * Charged only here, where a genuinely new attempt is claimed. Reusing a
       * verified Session, taking over a PENDING attempt, and the continue
       * redirect all consume nothing — a user must never be rate-limited out of
       * finishing a checkout they already started.
       *
       * Reserved rather than counted, so an outage or a lost claim race gives
       * the unit back instead of burning an hour of a legitimate user's budget.
       */
      onNewAttempt: async () => {
        const outcome = await reserve("billingAttempt", {
          headers: new Headers(),
          userId: auth.user.id,
        });

        if (outcome.kind === "allow") {
          held = outcome.reservation;
          return null;
        }

        refusal = rateLimitResponse(outcome);
        return { kind: "unavailable" };
      },
    });

    if (refusal) return refusal;

    if (outcome.kind === "session") {
      await recordEvent("upgrade_started", auth.user.id, { plan: "plus" });
      // Only a path. The Session URL never crosses this boundary.
      return apiSuccess({ continuePath: "/api/v1/billing/checkout/continue" });
    }

    // Nothing was created, so the reserved unit is not owed.
    if (held) await releaseReservation(held);
    return mapOutcome(outcome);
  } catch (error) {
    if (held) await releaseReservation(held);
    // The provider error object can carry request payloads and account
    // identifiers, so only its category leaves this scope.
    logFailure("billing.request_failed", "dependency_unavailable", { operation: "checkout" });
    captureException(error, { category: "dependency_unavailable" });
    return apiError("INTERNAL", "We could not start checkout. Please try again.");
  }
});

function mapOutcome(outcome: CheckoutOutcome) {
  switch (outcome.kind) {
    case "conflict":
      return apiError("CONFLICT", outcome.message, {
        ...(outcome.retryAfterSeconds
          ? { headers: { "Retry-After": String(outcome.retryAfterSeconds) } }
          : {}),
      });
    case "blocked":
      return apiError("CONFLICT", outcome.message);
    default:
      return apiError("SERVICE_UNAVAILABLE", "Billing is temporarily unavailable.", {
        headers: { "Retry-After": "30" },
      });
  }
}
