# ADR 0010: Billing concurrency and event-order-independent reconciliation

**Status:** Accepted

## Context

Stripe test-mode verification found two high-severity defects in the Phase 6 billing code. Both had
been invisible to every prior phase because Stripe had never executed.

**D1 — duplicate subscription creation.** `POST /api/v1/billing/checkout` created a Checkout Session
per request with no guard of any kind: no active-subscription check, no session reuse, no
idempotency key, no reservation, no rate limit. The billing page derived "am I subscribed" from a
local row written only by the webhook, so during any webhook delay it kept rendering an armed
"Upgrade to Plus". Verification produced **three simultaneous active subscriptions for one user and
CAD $54.00 of charges where $18.00 was owed.**

**D2 — entitlement mis-reconciliation.** The webhook wrote the triggering event's snapshot into a
single row keyed by `stripeCustomerId`, with no knowledge of the customer's other subscriptions.
Cancelling one of several active subscriptions downgraded a user who was still paying through
another, and a later `updated` on a survivor silently restored access. Stripe delivers at least once
with no ordering guarantee, so the outcome depended on arrival order rather than truth.

**D3 — non-atomic replay guard.** The processed-event check was `findUnique` then `create` with the
handler in between, so two simultaneous deliveries of one event could both pass.

## Decision

**PostgreSQL is the concurrency-correctness mechanism. Redis is defence in depth only.**

1. **A durable `CheckoutAttempt` claim.** `activeForUserId` is a nullable-unique column, so the
   database elects exactly one live attempt per user. The claim is taken **before** any Stripe call,
   and `stripeCustomerId` starts null — an earlier design resolved the Customer first, which let two
   concurrent first-time requests create two Customers before either wrote one down.

2. **The attempt id is the Stripe idempotency key.** Every caller that reaches the same row presents
   an identical key, so a lost response, a crash takeover, or a retry recovers the original object
   instead of creating a second. The attempt's TTL is set below Stripe's 24-hour key retention, so
   the local row always expires before the remote key does.

3. **An immutable request snapshot.** Stripe compares parameters when a key is reused, so anything
   recomputed on retry — an expiry from the clock, a URL from the environment, the currently
   configured Price — turns recovery into `idempotency_error`. `buildSessionRequest` reads the row
   and nothing else.

4. **The authoritative subscription check runs before every Session create, replay, reuse, or
   redirect**, not only before creation. A stored `stripeSessionId` never short-circuits it: a
   subscription can appear via the Portal, the Dashboard, an older Session, or a delayed webhook
   after a Session was opened.

5. **Open-Session discovery.** Retrieve-by-stored-id cannot see a Session that was created before its
   id was persisted, orphaned by a rollback, or created before this fix existed. Every URL-returning
   path enumerates the customer's open Sessions and retrieves line items explicitly — neither `list`
   nor `retrieve` includes them.

6. **A per-customer advisory lock, taken before the Stripe read.** `ProcessedWebhookEvent`
   deduplicates one event id; it does nothing for two different ids touching one customer. Without
   the lock, a slow handler's older snapshot lands after a faster handler's newer one.

7. **Entitlement is derived from the complete matching set**, never from the triggering event, using
   a canonical rule that is a pure function of that set. Two databases with different history
   converge on the same projection from identical Stripe state.

8. **Blocking is wider than entitlement.** `past_due`, `unpaid`, `paused`, and `incomplete` grant
   nothing yet must block a second subscription. Conflating the two is what sold the duplicates.

## Consequences

**Positive**

- Duplicate subscriptions are prevented by a database constraint, not by timing.
- Reconciliation is order-independent, so late, duplicated, and out-of-order events converge.
- A Redis outage cannot cause a duplicate charge, honouring ADR 0004.
- Unknown future Stripe statuses are storable and default to blocking.

**Negative**

- The webhook now makes a synchronous Stripe call inside a transaction holding the advisory lock.
  Bounded at 8 s against a 15 s transaction timeout, but it holds a pool connection for that time and
  makes webhooks slower. **The durable-inbox path — persist the event, return 200, reconcile in a
  worker holding the same lock — is the real answer at scale and is deliberately not implemented
  here.**
- Stripe Search is eventually consistent, so it is used only after the idempotency window has aged
  out, and any error refuses rather than creates.
- An external actor mutating Stripe between two of our API calls cannot be prevented. Every
  app-initiated path re-checks under one lock and every webhook-observed path expires the stale
  Session, so the design is convergent rather than preventive.

## Rollback

Additive and forward-only. No column is dropped or retyped and **no label is added to
`SubscriptionStatus`** — an older generated Prisma Client throws when it deserializes an enum value
it does not know, so adding one would make rollback unsafe the moment a single row carried it.
Statuses without a legacy label live in `stripeStatusRaw` and coerce to `INCOMPLETE`.

Rollback restores availability, **not correctness**: the old code reverts to last-event-wins, so D1
and D2 return. It is an incident lever, not a routine one.

## Alternatives rejected

- **Redis distributed lock.** A lost lock means a duplicate charge, which is a correctness
  consequence — exactly what ADR 0004 forbids Redis from carrying.
- **Stripe idempotency alone.** Two concurrent callers cannot agree on a key without shared state,
  and any clock-derived bucket has a boundary two requests can straddle.
- **Keeping the stored canonical id when still entitled.** Stable, but not a pure function: two
  databases could choose different canonical subscriptions from identical Stripe state.
