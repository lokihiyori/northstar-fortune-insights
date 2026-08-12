# Billing duplicates and blocked accounts

Operational procedures for the concurrency fix (ADR 0010). Everything here is **detect and alert
first**; nothing cancels or refunds automatically, because both move money.

## Alerts and what they mean

| Event                                                           | Severity | Meaning                                                                                        | First action                                                                                     |
| --------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `billing.duplicate_active_subscriptions`                        | error    | A customer has more than one live matching subscription. They are being billed more than once. | Confirm in the Dashboard, then follow "Duplicate subscriptions" below.                           |
| `billing.duplicate_customer`                                    | error    | More than one Stripe Customer resolves to one user. Checkout is now disabled for them.         | Follow "Duplicate Customers".                                                                    |
| `billing.blocked`                                               | error    | `billingBlockedReason` was set; the user cannot start a checkout.                              | Resolve the cause, then clear the flag.                                                          |
| `billing.mode_mismatch`                                         | error    | An object or event arrived in the wrong Stripe mode. **Keys may be crossed.**                  | Stop and check which key the process holds. Do not clear by hand.                                |
| `billing.session_foreign_attempt`                               | error    | An open Session names another attempt.                                                         | Investigate before any expiry; never expire a Session you cannot attribute.                      |
| `billing.session_ambiguous`                                     | error    | Two verified open Sessions for one customer. Checkout is refusing.                             | Expire the ones you can attribute; leave the rest.                                               |
| `billing.session_expire_unconfirmed`                            | error    | A Session could not be confirmed closed, so a claim was held.                                  | Retry; if persistent, expire it manually and confirm.                                            |
| `billing.discovery_incomplete` / `billing.reconcile_incomplete` | error    | Pagination bound exceeded or Stripe unavailable. Nothing was reconciled.                       | Usually transient. If persistent, the customer may have pathologically many objects — see below. |
| `billing.unmapped_customer_event`                               | error    | An event that looks like ours has no local Customer mapping. Retryable.                        | Check for a mapping write that failed.                                                           |
| `billing.cross_linked_metadata`                                 | error    | Subscription metadata names a different user. **Data-integrity incident.**                     | Investigate manually; entitlement was not changed.                                               |

Alerts carry identifiers and counts only — never an amount, card, invoice, email, or Checkout URL.

## Detecting duplicates

```sql
-- Customers billing more than once.
SELECT "userId", "entitledCount", "matchingBlockingCount", "reconciledAt"
  FROM subscriptions
 WHERE "matchingBlockingCount" > 1
 ORDER BY "matchingBlockingCount" DESC;

-- Accounts an operator has blocked.
SELECT "userId", "billingBlockedReason" FROM subscriptions
 WHERE "billingBlockedReason" IS NOT NULL;

-- Reconciliation that keeps failing.
SELECT "userId", "reconcileFailureCount", "reconcileFailedAt" FROM subscriptions
 WHERE "reconcileFailureCount" > 0 ORDER BY "reconcileFailedAt" DESC;
```

`matchingBlockingCount > 1` is the duplicate-risk signal, and it is deliberately wider than
`entitledCount`: an `active` + `past_due` pair bills twice while only one grants access.

## Duplicate subscriptions

1. **Preserve evidence first.** Record every subscription id, invoice id, and amount **before**
   cancelling — cancelling removes them from the Dashboard's active view.
2. **Do not auto-cancel and do not auto-refund.** Both need a human decision.
3. Entitlement is already correct: reconciliation derives it from the whole set, so the user is not
   wrongly downgraded while duplicates exist.
4. With approval, cancel the non-canonical subscriptions. The canonical one is the highest-priority
   entitled subscription by `(status priority, created ASC, id ASC)`.
5. Refund at the owner's discretion, then notify the affected user.

## Duplicate Customers

`billingBlockedReason = 'duplicate_customer'` means more than one Stripe Customer carries this
user's id. **Checkout stays disabled until an operator clears it** — probing subscriptions on one
arbitrarily chosen Customer could create a new subscription while another already holds one.

1. List the Customers and their subscriptions.
2. Decide which is canonical (normally the one holding the live subscription).
3. Point `subscriptions.stripeCustomerId` at it.
4. Clear the flag:
   ```sql
   UPDATE subscriptions SET "billingBlockedReason" = NULL WHERE "userId" = $1;
   ```
5. Let the next webhook, or a checkout attempt, reconcile.

## Legacy open Checkout Sessions

Sessions created before this fix carry no `attemptId`. They are invisible to the attempt table and
can still be completed by a stale browser tab.

```
node --env-file=.env scripts/report-open-checkout-sessions.mjs
```

**Read-only. It refuses to run against live mode and prints no Checkout URL or secret.** Exit code
`2` means pre-fix Sessions exist.

The application remediates lazily: the next checkout for that customer discovers the legacy Session,
expires it, and confirms it before creating a replacement. For users who never return, expire with
an explicit single-target command after confirming the Session belongs to this product:

```
stripe checkout sessions expire <cs_test_id>
```

Never expire a Session you cannot attribute to the server-owned Price and a known Customer.

## A customer with more objects than the safety bound

Discovery and reconciliation stop at 5 pages (500 objects) and refuse rather than act on a truncated
view. Webhooks then return 500 and Stripe retries with its own backoff; the alert fires at most once
an hour per customer.

Resolve by reducing the object count (cancel duplicates with approval), or raise the bound in
`session-discovery.ts` / `reconcile.ts` temporarily. Do not "fix" it by reconciling from a partial
read — that is how a customer loses access they are paying for.
