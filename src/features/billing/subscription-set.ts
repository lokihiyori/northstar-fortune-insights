/**
 * The subscription truth model: which Stripe subscriptions count, what they
 * entitle, what they block, and which one is canonical.
 *
 * **Pure by design.** Nothing here reads the clock, the environment, the
 * database, or the previously stored projection. Given the same set of
 * subscriptions it always produces the same answer — on any machine, in any
 * order, regardless of what the database happened to hold before. That property
 * is the D2 fix: entitlement can no longer depend on which webhook arrived last.
 */

import type { SubscriptionStatus } from "@/generated/prisma/enums";

/**
 * Statuses that grant PLUS. Unchanged from the pre-fix product rule — the
 * defect was never in *which* statuses entitle, but in how the set was read.
 */
const ENTITLED_STATUSES = new Set(["active", "trialing"]);

/**
 * Statuses that block a second subscription.
 *
 * **Deliberately wider than the entitled set.** `past_due`, `unpaid`, `paused`,
 * and `incomplete` grant nothing, yet each is a live subscription that can still
 * bill. Offering "Upgrade to Plus" in those states is exactly how a customer
 * ends up paying twice — so blocking and entitlement are separate questions.
 */
const BLOCKING_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);

/** Terminal: neither entitles nor blocks. */
const TERMINAL_STATUSES = new Set(["canceled", "incomplete_expired"]);

/** Stripe status strings this product knows about. */
export const KNOWN_STATUSES = new Set([...BLOCKING_STATUSES, ...TERMINAL_STATUSES]);

export function isKnownStatus(raw: string): boolean {
  return KNOWN_STATUSES.has(raw);
}

export function isEntitledStatus(raw: string): boolean {
  return ENTITLED_STATUSES.has(raw);
}

/**
 * An unknown status blocks.
 *
 * A status Stripe ships after this code was written is far more likely to be a
 * live state than a terminal one, and the failure directions are not
 * symmetrical: wrongly blocking costs a support ticket, wrongly allowing costs
 * a duplicate charge.
 */
export function isBlockingStatus(raw: string): boolean {
  if (TERMINAL_STATUSES.has(raw)) return false;
  return true;
}

/**
 * Maps a raw Stripe status onto the legacy enum.
 *
 * **Only ever returns one of the six labels that existed before this fix.**
 * `paused`, `incomplete_expired`, and anything unknown collapse to `INCOMPLETE`,
 * exactly as the pre-fix `mapStripeStatus` did. That is what keeps the migration
 * genuinely reverse-compatible: an older generated Prisma Client is never asked
 * to deserialize a label it does not have.
 */
export function coarseStatus(raw: string): SubscriptionStatus {
  switch (raw) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "unpaid":
      return "UNPAID";
    default:
      return "INCOMPLETE";
  }
}

/**
 * A subscription reduced to the fields the projection needs.
 *
 * Deliberately not Stripe's type: reconciliation must be testable without the
 * SDK, and narrowing here documents exactly which fields any decision may read.
 */
export type MatchedSubscription = {
  id: string;
  statusRaw: string;
  created: number;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  priceId: string;
};

/**
 * Ordering within a class. Applied *before* `created`, so the rule is total and
 * documented rather than emergent.
 */
const ENTITLED_RANK: Record<string, number> = { active: 0, trialing: 1 };
const BLOCKING_RANK: Record<string, number> = {
  past_due: 0,
  unpaid: 1,
  paused: 2,
  incomplete: 3,
};
const UNKNOWN_RANK = 4;

function rankOf(statusRaw: string, entitled: boolean): number {
  if (entitled) return ENTITLED_RANK[statusRaw] ?? UNKNOWN_RANK;
  return BLOCKING_RANK[statusRaw] ?? UNKNOWN_RANK;
}

function compare(a: MatchedSubscription, b: MatchedSubscription, entitled: boolean): number {
  const rank = rankOf(a.statusRaw, entitled) - rankOf(b.statusRaw, entitled);
  if (rank !== 0) return rank;
  if (a.created !== b.created) return a.created - b.created;
  // Total ordering even for two subscriptions created in the same second.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type ProjectionInput = {
  matching: readonly MatchedSubscription[];
};

export type Projection = {
  plan: "FREE" | "PLUS";
  statusRaw: string | null;
  status: SubscriptionStatus;
  canonicalId: string | null;
  priceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  entitledCount: number;
  matchingBlockingCount: number;
  /** More than one live subscription — bills twice, entitles once. */
  duplicateRisk: boolean;
};

/**
 * Derives the whole projection from the current matching set.
 *
 * **Takes no previously stored canonical id.** An earlier revision of this
 * design kept the stored subscription when it was still entitled, which is
 * stable but not a pure function: two databases holding different history could
 * choose different canonical subscriptions from identical Stripe state. The
 * cost of dropping it is that the canonical id may move when an older
 * subscription appears; the benefit is that the same Stripe set always produces
 * the same row everywhere.
 */
export function deriveProjection(input: ProjectionInput): Projection {
  const entitled = input.matching.filter((s) => isEntitledStatus(s.statusRaw));
  const blocking = input.matching.filter((s) => isBlockingStatus(s.statusRaw));

  const useEntitled = entitled.length > 0;
  const pool = useEntitled ? entitled : blocking;

  const canonical =
    pool.length > 0 ? [...pool].sort((a, b) => compare(a, b, useEntitled))[0] : undefined;

  return {
    plan: useEntitled ? "PLUS" : "FREE",
    statusRaw: canonical?.statusRaw ?? null,
    status: canonical ? coarseStatus(canonical.statusRaw) : "CANCELED",
    canonicalId: canonical?.id ?? null,
    priceId: canonical?.priceId ?? null,
    currentPeriodEnd: canonical?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: canonical?.cancelAtPeriodEnd ?? false,
    entitledCount: entitled.length,
    matchingBlockingCount: blocking.length,
    duplicateRisk: blocking.length > 1,
  };
}

/** True when any matching subscription blocks a new Checkout. */
export function hasBlockingSubscription(matching: readonly MatchedSubscription[]): boolean {
  return matching.some((s) => isBlockingStatus(s.statusRaw));
}
