import type { Metadata } from "next";
import { BillingActionButton, ContinueCheckoutLink } from "@/components/billing/upgrade-button";
import { Badge } from "@/components/ui/badge";
import { UsageMeter } from "@/components/ui/usage-meter";
import { requireUser } from "@/features/auth/guards";
import { isDemoSession } from "@/features/demo/session";
import { getEntitlements } from "@/features/billing/entitlements";
import { isBillingConfigured } from "@/features/billing/stripe";
import { getSubscription } from "@/features/billing/subscription";
import { liveAttemptForUser } from "@/features/billing/checkout-attempt";
import { countReportsThisPeriod } from "@/features/guidance/usage";
import { PLANS, PRICING_NOTE } from "@/features/billing/plans";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("/app/billing");
  const params = await searchParams;

  const [entitlements, subscription, used] = await Promise.all([
    getEntitlements(user.id),
    getSubscription(user.id),
    countReportsThisPeriod(user.id),
  ]);

  const configured = isBillingConfigured();
  const isDemo = isDemoSession(user);
  const isPlus = entitlements.plan === "plus";
  const checkout = params["checkout"];

  /**
   * Pending-checkout state, read from local rows only.
   *
   * No Stripe call happens on render: the attempt table answers "is a checkout
   * in flight", and the projection answers "what does Stripe currently say".
   * Calling Stripe here would put a network round trip on every page view and
   * make the page fail when Stripe is slow.
   */
  const attempt = await liveAttemptForUser(user.id);
  const attemptState: "none" | "preparing" | "open" | "processing" =
    attempt === null
      ? "none"
      : attempt.status === "PENDING"
        ? "preparing"
        : attempt.status === "OPEN"
          ? "open"
          : "processing";

  /**
   * A live subscription that grants nothing — past_due, unpaid, paused, or
   * incomplete. Blocking and entitlement are separate questions, and conflating
   * them is what let a user in this state buy a second subscription.
   */
  const isBlockedNotEntitled =
    !isPlus && subscription !== null && (subscription.matchingBlockingCount ?? 0) > 0;

  const duplicateRisk = (subscription?.matchingBlockingCount ?? 0) > 1;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Plan and usage</h1>

      {checkout === "success" ? (
        <div
          role="status"
          className="border-success/30 bg-success/10 rounded-control mt-6 border p-4"
        >
          <p className="text-success text-sm">
            Checkout complete. Your plan updates as soon as Stripe confirms the payment — this is
            usually immediate, but access is granted by the confirmation, not by this page.
          </p>
        </div>
      ) : null}

      {checkout === "cancelled" ? (
        <div className="border-border bg-surface-raised rounded-control mt-6 border p-4">
          <p className="text-text-secondary text-sm">
            Checkout was cancelled. Nothing was charged.
          </p>
        </div>
      ) : null}

      {duplicateRisk ? (
        <div
          role="alert"
          className="border-warning/40 bg-warning/10 rounded-control mt-6 border p-4"
        >
          <p className="text-sm">
            We can see more than one live subscription on your billing account. You may be being
            charged more than once. Open <strong>Manage billing</strong> to review them, or contact
            support and we will sort it out — please do not start another subscription.
          </p>
        </div>
      ) : null}

      <section aria-labelledby="current-heading" className="mt-8">
        <div className="border-border bg-surface rounded-card border p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="current-heading" className="text-sm font-semibold">
                Current plan
              </h2>
              <p className="font-display mt-1 text-2xl font-semibold">
                {isPlus ? "NorthStar Plus" : "Free"}
              </p>
            </div>
            <Badge tone={isPlus ? "teal" : "neutral"}>
              {subscription?.status.toLowerCase().replace(/_/g, " ") ?? "active"}
            </Badge>
          </div>

          {subscription?.currentPeriodEnd ? (
            <p className="text-text-secondary mt-3 text-sm">
              {subscription.cancelAtPeriodEnd ? "Access ends" : "Renews"} on{" "}
              {subscription.currentPeriodEnd.toLocaleDateString("en-CA", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              .
            </p>
          ) : null}

          <dl className="border-border mt-6 grid gap-4 border-t pt-6 sm:grid-cols-2">
            <div>
              <dt className="text-text-secondary text-xs">Reports per month</dt>
              <dd className="mt-0.5 text-sm">{entitlements.monthlyReports}</dd>
            </div>
            <div>
              <dt className="text-text-secondary text-xs">Active plans</dt>
              <dd className="mt-0.5 text-sm">{entitlements.maxActivePlans}</dd>
            </div>
            <div>
              <dt className="text-text-secondary text-xs">History retained</dt>
              <dd className="mt-0.5 text-sm">
                {entitlements.historyDays
                  ? `${String(entitlements.historyDays)} days`
                  : "Unlimited"}
              </dd>
            </div>
            <div>
              <dt className="text-text-secondary text-xs">Report exports</dt>
              <dd className="mt-0.5 text-sm">
                {entitlements.canExport ? "Included" : "Not included"}
              </dd>
            </div>
          </dl>

          <div className="mt-6">
            {isDemo ? (
              /*
               * The demo account never sees an upgrade button. Checkout and the
               * Customer Portal both refuse it server-side, so rendering one
               * would be a control that fails after the click — and a shared
               * recruiter login has no business opening a real payment flow.
               */
              <p className="text-text-secondary text-sm">
                Billing is unavailable in the demo workspace. The demo account stays on the Free
                plan, which includes enough capacity for a full guidance journey. No payment method
                is collected and no subscription is created.
              </p>
            ) : !configured ? (
              // Honest about the deployment rather than showing a button that
              // cannot work.
              <p className="text-text-secondary text-sm">
                Billing is not configured on this deployment, so upgrading is unavailable. Set
                <code className="mx-1 font-mono text-xs">STRIPE_SECRET_KEY</code>,
                <code className="mx-1 font-mono text-xs">STRIPE_PLUS_PRICE_ID</code>, and
                <code className="mx-1 font-mono text-xs">STRIPE_WEBHOOK_SECRET</code> to enable it.
              </p>
            ) : subscription?.billingBlockedReason ? (
              /*
               * More than one Stripe Customer resolved to this account. Probing
               * subscriptions on one of them could create a second subscription
               * while another already holds one, so billing stays closed until
               * an operator has reconciled it.
               */
              <p role="status" className="text-text-secondary text-sm">
                Billing needs a manual review for this account before it can continue. Please
                contact support — no action is needed from you, and nothing has been charged.
              </p>
            ) : attemptState === "preparing" ? (
              /*
               * Claimed but no Session exists yet. Deliberately offers no
               * Continue link and no second Upgrade: there is nothing to
               * continue to, and arming Upgrade here is what produced D1.
               */
              <p role="status" className="text-text-secondary text-sm">
                Preparing checkout… This usually takes a moment. Refresh the page to see the latest
                state.
              </p>
            ) : attemptState === "open" ? (
              <div>
                <ContinueCheckoutLink label="Continue checkout" />
                <p className="text-text-secondary mt-3 text-sm">
                  You already have a checkout in progress. Continuing uses the same session, so you
                  will not be charged twice.
                </p>
              </div>
            ) : attemptState === "processing" ? (
              /*
               * Payment taken, projection not yet updated. Access is granted by
               * the webhook, never by the redirect — so this state waits rather
               * than offering another upgrade.
               */
              <p role="status" className="text-text-secondary text-sm">
                Payment processing. Your plan updates as soon as Stripe confirms it — this is
                usually immediate. Refresh the page to check.
              </p>
            ) : isBlockedNotEntitled ? (
              /*
               * past_due, unpaid, paused, or incomplete: a live subscription
               * that grants nothing. Offering "Upgrade" here sells a second
               * subscription to someone who already has one.
               */
              <div>
                <BillingActionButton
                  endpoint="portal"
                  label="Update payment method"
                  variant="secondary"
                />
                <p className="text-text-secondary mt-3 text-sm">
                  There is a problem with your existing subscription. Update your payment details to
                  restore access — starting a new subscription would charge you twice.
                </p>
              </div>
            ) : isPlus ? (
              <BillingActionButton endpoint="portal" label="Manage billing" variant="secondary" />
            ) : (
              <BillingActionButton endpoint="checkout" label="Upgrade to Plus" />
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="usage-heading" className="mt-8">
        <h2 id="usage-heading" className="sr-only">
          Usage
        </h2>
        <UsageMeter used={used} allowance={entitlements.monthlyReports} />
        <p className="text-text-secondary mt-3 text-sm">
          A failed generation never counts against your allowance. Regenerating a report does,
          because it runs the full analysis again.
        </p>
      </section>

      <section aria-labelledby="plans-heading" className="border-border mt-12 border-t pt-8">
        <h2 id="plans-heading" className="text-lg font-semibold tracking-tight">
          What each plan includes
        </h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <div key={plan.id} className="border-border rounded-card border p-5">
              <h3 className="text-sm font-semibold">{plan.name}</h3>
              <p className="font-display mt-1 text-xl font-semibold">
                {plan.priceCad === 0 ? "$0" : `$${String(plan.priceCad)}`}
                <span className="text-text-secondary ml-1 text-sm font-normal">
                  CAD {plan.cadence}
                </span>
              </p>
              <ul className="mt-4 space-y-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="text-text-secondary text-sm">
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-text-secondary mt-5 text-sm">{PRICING_NOTE}</p>
      </section>
    </div>
  );
}
