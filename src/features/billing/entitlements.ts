import "server-only";

/**
 * Single server-side source of entitlement truth (spec section 13).
 *
 * Plan checks must never be scattered through UI components, and nothing the
 * client sends about its own plan may be trusted. Phase 6 derives the plan from
 * the local Stripe subscription projection; until then every account is Free.
 */
export type Entitlements = {
  plan: "free" | "plus";
  monthlyReports: number;
  maxActivePlans: number;
  canExport: boolean;
  canUseAdvancedCompare: boolean;
  historyDays: number | null;
};

const FREE: Entitlements = {
  plan: "free",
  monthlyReports: 3,
  maxActivePlans: 1,
  canExport: false,
  canUseAdvancedCompare: false,
  historyDays: 30,
};

const PLUS: Entitlements = {
  plan: "plus",
  monthlyReports: 30,
  maxActivePlans: 10,
  canExport: true,
  canUseAdvancedCompare: true,
  historyDays: null,
};

export function entitlementsForPlan(plan: "free" | "plus"): Entitlements {
  return plan === "plus" ? PLUS : FREE;
}

/** Async now so Phase 6 can read the subscription without changing callers. */
export function getEntitlements(_userId: string): Promise<Entitlements> {
  return Promise.resolve(FREE);
}

/** Period key for the usage ledger, e.g. "2026-08". */
export function currentPeriodKey(now = new Date()): string {
  return `${String(now.getUTCFullYear())}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
