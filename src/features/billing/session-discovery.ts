import "server-only";

import type Stripe from "stripe";

import { expectedLivemode } from "./stripe";

/**
 * Finding and verifying open Checkout Sessions for a customer.
 *
 * **Retrieving by stored id is not enough.** A Session can exist that this
 * application has no row for: created before its id was persisted, orphaned by a
 * rollback, created before Session metadata carried an attempt id, or created
 * before this fix existed at all. Any of those can still be completed by a
 * browser tab and still create a second subscription — so every path that would
 * return or create a Checkout URL enumerates the customer's open Sessions first.
 *
 * Line items are **retrieved explicitly**. Neither `sessions.list` nor
 * `sessions.retrieve` includes them, so a price check that reads
 * `session.line_items` without expanding would silently verify nothing.
 */

const MAX_PAGES = 5;
const PAGE_SIZE = 100;

export type SessionOwnership =
  /** Carries this attempt's id — provably ours. */
  | { kind: "own"; session: Stripe.Checkout.Session }
  /** Verified, same customer and Price, but no attempt id: pre-fix. */
  | { kind: "legacy"; session: Stripe.Checkout.Session }
  /** Carries a different attempt's id. */
  | { kind: "foreign"; session: Stripe.Checkout.Session };

export type DiscoveryResult =
  | { kind: "ok"; candidates: SessionOwnership[] }
  /** Pagination bound hit, or a line-item lookup failed. Caller must refuse. */
  | { kind: "incomplete" };

function metadataOf(session: Stripe.Checkout.Session): {
  userId: string | undefined;
  attemptId: string | undefined;
} {
  const raw = session.metadata ?? {};
  return { userId: raw["userId"] ?? undefined, attemptId: raw["attemptId"] ?? undefined };
}

/**
 * Every check a Session must pass before its URL may be offered.
 *
 * `subscription` being null is the one most easily overlooked: a Session that
 * already produced a subscription must never be handed back, or completing it
 * again is exactly the duplicate this whole design exists to prevent.
 */
async function verify(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  args: { customerId: string; userId: string; priceId: string; now: Date },
): Promise<boolean> {
  if (session.status !== "open") return false;
  if (session.livemode !== expectedLivemode()) return false;
  if (session.mode !== "subscription") return false;
  if (session.subscription !== null && session.subscription !== undefined) return false;

  const customer =
    typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  if (customer !== args.customerId) return false;

  // At least two minutes of usable life, so a user is not handed a URL that
  // expires while the page is loading.
  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  if (expiresAtMs <= args.now.getTime() + 2 * 60 * 1000) return false;

  const metadata = metadataOf(session);
  if (metadata.userId !== undefined && metadata.userId !== args.userId) return false;

  // Explicit retrieval — list and retrieve responses do not carry line items.
  let items: Stripe.ApiList<Stripe.LineItem>;
  try {
    items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 2 });
  } catch {
    return false;
  }

  if (items.data.length !== 1) return false;
  const price = items.data[0]?.price;
  if (!price || price.id !== args.priceId) return false;

  return true;
}

/**
 * Enumerates every open Session for the customer and classifies the verified
 * ones. Unverified Sessions — another Price, another customer, a one-off
 * payment — are dropped entirely: they are not ours to reuse *or* to expire.
 */
export async function discoverOpenSessions(
  stripe: Stripe,
  args: { customerId: string; userId: string; priceId: string; attemptId: string; now: Date },
): Promise<DiscoveryResult> {
  const candidates: SessionOwnership[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let batch: Stripe.ApiList<Stripe.Checkout.Session>;
    try {
      batch = await stripe.checkout.sessions.list({
        customer: args.customerId,
        status: "open",
        limit: PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
    } catch {
      return { kind: "incomplete" };
    }

    for (const session of batch.data) {
      if (!(await verify(stripe, session, args))) continue;

      const attemptId = metadataOf(session).attemptId;
      if (attemptId === args.attemptId) candidates.push({ kind: "own", session });
      else if (attemptId === undefined) candidates.push({ kind: "legacy", session });
      else candidates.push({ kind: "foreign", session });
    }

    if (!batch.has_more) return { kind: "ok", candidates };

    // Stripe says there is more but gave us nothing to page from. Treating that
    // as a complete answer would mean concluding "no other Session exists"
    // without having looked.
    startingAfter = batch.data.at(-1)?.id;
    if (!startingAfter) return { kind: "incomplete" };
  }

  // More pages than the safety bound. Reconciling from a truncated view would
  // mean deciding "no other Session exists" without having looked.
  return { kind: "incomplete" };
}

/**
 * Expires a Session and confirms it can no longer be completed.
 *
 * Re-retrieving is the point: `expire` returning without throwing is not proof,
 * and releasing a claim while a completable Session is still open is precisely
 * how a second subscription gets created.
 */
export async function expireAndConfirm(stripe: Stripe, sessionId: string): Promise<boolean> {
  try {
    await stripe.checkout.sessions.expire(sessionId);
    const after = await stripe.checkout.sessions.retrieve(sessionId);
    return after.status !== "open";
  } catch {
    return false;
  }
}
