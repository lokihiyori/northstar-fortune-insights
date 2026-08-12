import { NextResponse } from "next/server";

import { requireApiUser } from "@/features/auth/guards";
import { assertNotDemo } from "@/features/demo/session";
import { runCheckoutFlow } from "@/features/billing/checkout-flow";
import { setContextActor } from "@/lib/observability/context";
import { withApiLogging } from "@/lib/observability/handler";
import { logFailure } from "@/lib/observability/logger";
import { captureException } from "@/lib/observability/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends the signed-in user to their Checkout Session.
 *
 * Three properties this route exists to provide:
 *
 *  1. **The Session URL never touches the client except as a redirect.** It is
 *     bearer-like — anyone holding it can complete the payment — so it is
 *     fetched server-side, revalidated, and handed straight to the browser as a
 *     303. It is never persisted, never logged, and never returned in a body.
 *
 *  2. **Nothing is taken from the request.** No Session id, no URL, no attempt
 *     id. The attempt is derived entirely from the authenticated user's
 *     server-owned state, so a caller cannot aim this route at someone else's
 *     Session or at an arbitrary destination.
 *
 *  3. **The authoritative subscription check runs again here.** A subscription
 *     can appear between the Session being opened and this redirect, and
 *     continuing to a live Session in that window is exactly how a second
 *     subscription is created.
 */

/** Only hosts Stripe serves hosted Checkout from. Guards against open redirect. */
const ALLOWED_REDIRECT_HOSTS = new Set(["checkout.stripe.com", "billing.stripe.com"]);

function isSafeStripeUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && ALLOWED_REDIRECT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** A redirect back to the billing page, which renders the right recovery state. */
function backToBilling(appUrl: string, reason: string): NextResponse {
  const response = NextResponse.redirect(`${appUrl}/app/billing?checkout=${reason}`, 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const GET = withApiLogging("/api/v1/billing/checkout/continue", async () => {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  setContextActor(auth.user.id);

  const notDemo = await assertNotDemo(auth.user.id, "Billing");
  if (!notDemo.ok) return notDemo.response;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    // `mayClaim: false` — continuing must never mint a new attempt, and never
    // charges the rate limit. It is recovery, not a new purchase.
    const outcome = await runCheckoutFlow({ userId: auth.user.id, mayClaim: false, appUrl });

    if (outcome.kind !== "session") {
      return backToBilling(appUrl, outcome.kind === "conflict" ? "processing" : "unavailable");
    }

    if (!isSafeStripeUrl(outcome.url)) {
      // Stripe returned something that is not a hosted Checkout URL. Redirecting
      // to it would be an open redirect with our session behind it.
      logFailure("billing.request_failed", "dependency_unavailable", { operation: "continue" });
      return backToBilling(appUrl, "unavailable");
    }

    const response = NextResponse.redirect(outcome.url, 303);
    // The URL is in the Location header only. `no-store` keeps it out of shared
    // caches and out of the browser's back-forward cache.
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    logFailure("billing.request_failed", "dependency_unavailable", { operation: "continue" });
    captureException(error, { category: "dependency_unavailable" });
    return backToBilling(appUrl, "unavailable");
  }
});
