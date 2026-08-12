import { describe, expect, it } from "vitest";

import {
  coarseStatus,
  deriveProjection,
  hasBlockingSubscription,
  isBlockingStatus,
  isEntitledStatus,
  isKnownStatus,
  type MatchedSubscription,
} from "@/features/billing/subscription-set";

/**
 * The truth model and the canonical rule.
 *
 * The permutation tests here are the D2 regression gate: before the fix the
 * projection depended on which webhook arrived last, so the same Stripe state
 * could produce PLUS or FREE depending on timing.
 */

function sub(overrides: Partial<MatchedSubscription> & { id: string }): MatchedSubscription {
  return {
    statusRaw: "active",
    created: 1_000,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    priceId: "price_plus",
    ...overrides,
  };
}

/** Every permutation of an array, for order-invariance proofs. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i]!, ...tail]);
  }
  return out;
}

// --- U1/U2/U3: the status table ------------------------------------------

describe("status table: entitlement", () => {
  it.each([
    ["active", true],
    ["trialing", true],
    ["paused", false],
    ["past_due", false],
    ["unpaid", false],
    ["incomplete", false],
    ["incomplete_expired", false],
    ["canceled", false],
  ])("%s entitles: %s", (status, entitled) => {
    expect(isEntitledStatus(status)).toBe(entitled);
  });

  it("an unknown future status never entitles", () => {
    expect(isEntitledStatus("some_status_stripe_ships_in_2027")).toBe(false);
  });
});

describe("status table: blocking", () => {
  it.each([
    ["active", true],
    ["trialing", true],
    ["paused", true],
    ["past_due", true],
    ["unpaid", true],
    ["incomplete", true],
    ["incomplete_expired", false],
    ["canceled", false],
  ])("%s blocks a new Checkout: %s", (status, blocking) => {
    expect(isBlockingStatus(status)).toBe(blocking);
  });

  it("an unknown future status blocks, because the failure directions are not symmetrical", () => {
    expect(isBlockingStatus("some_status_stripe_ships_in_2027")).toBe(true);
  });

  it("blocking is strictly wider than entitlement", () => {
    for (const status of ["past_due", "unpaid", "paused", "incomplete"]) {
      expect(isEntitledStatus(status)).toBe(false);
      expect(isBlockingStatus(status)).toBe(true);
    }
  });
});

// --- U14: unknown status never reaches the legacy enum --------------------

describe("coarse status keeps the legacy enum rollback-safe", () => {
  const LEGACY_LABELS = ["ACTIVE", "TRIALING", "PAST_DUE", "CANCELED", "INCOMPLETE", "UNPAID"];

  it.each([
    ["active", "ACTIVE"],
    ["trialing", "TRIALING"],
    ["past_due", "PAST_DUE"],
    ["canceled", "CANCELED"],
    ["unpaid", "UNPAID"],
    ["incomplete", "INCOMPLETE"],
    ["paused", "INCOMPLETE"],
    ["incomplete_expired", "INCOMPLETE"],
  ])("%s maps to %s", (raw, coarse) => {
    expect(coarseStatus(raw)).toBe(coarse);
  });

  it("never produces a label outside the six that existed before the fix", () => {
    const candidates = [...KNOWN, "paused", "totally_new_status", "", "ACTIVE"];
    for (const raw of candidates) {
      expect(LEGACY_LABELS).toContain(coarseStatus(raw));
    }
  });
});

const KNOWN = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
  "canceled",
  "incomplete_expired",
];

describe("known-status catalogue", () => {
  it("covers every status Stripe documents today", () => {
    for (const status of KNOWN) expect(isKnownStatus(status)).toBe(true);
  });

  it("does not claim to know a future status", () => {
    expect(isKnownStatus("some_status_stripe_ships_in_2027")).toBe(false);
  });
});

// --- U21/U22: canonical selection is a pure function of the set -----------

describe("canonical selection", () => {
  it("picks the oldest entitled subscription", () => {
    const set = [
      sub({ id: "sub_new", created: 3_000 }),
      sub({ id: "sub_old", created: 1_000 }),
      sub({ id: "sub_mid", created: 2_000 }),
    ];
    expect(deriveProjection({ matching: set }).canonicalId).toBe("sub_old");
  });

  it("ranks active before trialing regardless of age", () => {
    const set = [
      sub({ id: "sub_trial", statusRaw: "trialing", created: 1_000 }),
      sub({ id: "sub_active", statusRaw: "active", created: 9_000 }),
    ];
    expect(deriveProjection({ matching: set }).canonicalId).toBe("sub_active");
  });

  it("prefers any entitled subscription over every blocking one", () => {
    const set = [
      sub({ id: "sub_pastdue", statusRaw: "past_due", created: 1 }),
      sub({ id: "sub_active", statusRaw: "active", created: 9_999 }),
    ];
    const projection = deriveProjection({ matching: set });
    expect(projection.canonicalId).toBe("sub_active");
    expect(projection.plan).toBe("PLUS");
  });

  it("falls back to the highest-priority blocking subscription when none entitle", () => {
    const set = [
      sub({ id: "sub_incomplete", statusRaw: "incomplete", created: 1 }),
      sub({ id: "sub_pastdue", statusRaw: "past_due", created: 9_999 }),
    ];
    const projection = deriveProjection({ matching: set });
    // past_due ranks above incomplete, so it wins despite being newer.
    expect(projection.canonicalId).toBe("sub_pastdue");
    expect(projection.plan).toBe("FREE");
  });

  it("breaks a same-second tie by id, so the ordering is total", () => {
    const set = [sub({ id: "sub_b", created: 500 }), sub({ id: "sub_a", created: 500 })];
    expect(deriveProjection({ matching: set }).canonicalId).toBe("sub_a");
  });

  it("returns the identical projection for every input permutation", () => {
    const set = [
      sub({ id: "sub_a", statusRaw: "active", created: 100 }),
      sub({ id: "sub_b", statusRaw: "trialing", created: 50 }),
      sub({ id: "sub_c", statusRaw: "past_due", created: 10 }),
      sub({ id: "sub_d", statusRaw: "canceled", created: 5 }),
    ];

    const results = permutations(set).map((order) => deriveProjection({ matching: order }));
    const first = JSON.stringify(results[0]);

    expect(results).toHaveLength(24);
    for (const result of results) expect(JSON.stringify(result)).toBe(first);
  });

  it("takes no previously stored canonical id, so history cannot influence it", () => {
    // deriveProjection's signature accepts only the current set. This test
    // documents the guarantee that two databases with different history
    // converge on the same answer from identical Stripe state.
    const set = [sub({ id: "sub_x", created: 10 }), sub({ id: "sub_y", created: 20 })];
    const a = deriveProjection({ matching: set });
    const b = deriveProjection({ matching: [...set].reverse() });
    expect(a).toEqual(b);
  });
});

// --- U15/U16: counters ----------------------------------------------------

describe("counters", () => {
  it("counts an active + past_due pair as duplicate-risk even though only one entitles", () => {
    const projection = deriveProjection({
      matching: [
        sub({ id: "sub_active", statusRaw: "active", created: 1 }),
        sub({ id: "sub_pastdue", statusRaw: "past_due", created: 2 }),
      ],
    });

    expect(projection.entitledCount).toBe(1);
    expect(projection.matchingBlockingCount).toBe(2);
    expect(projection.duplicateRisk).toBe(true);
    expect(projection.plan).toBe("PLUS");
  });

  it("does not flag duplicate risk for a single live subscription", () => {
    const projection = deriveProjection({ matching: [sub({ id: "sub_only" })] });
    expect(projection.matchingBlockingCount).toBe(1);
    expect(projection.duplicateRisk).toBe(false);
  });

  it("reports zero counts and FREE for an empty set", () => {
    const projection = deriveProjection({ matching: [] });
    expect(projection).toMatchObject({
      plan: "FREE",
      canonicalId: null,
      entitledCount: 0,
      matchingBlockingCount: 0,
      duplicateRisk: false,
      status: "CANCELED",
    });
  });

  it("ignores terminal subscriptions in both counts", () => {
    const projection = deriveProjection({
      matching: [
        sub({ id: "sub_gone", statusRaw: "canceled" }),
        sub({ id: "sub_dead", statusRaw: "incomplete_expired" }),
      ],
    });
    expect(projection.entitledCount).toBe(0);
    expect(projection.matchingBlockingCount).toBe(0);
    expect(projection.plan).toBe("FREE");
  });
});

// --- D2: deleting one of several actives keeps PLUS ------------------------

describe("D2 regression: entitlement follows the set, not the event", () => {
  it("keeps PLUS when one of two entitled subscriptions disappears", () => {
    const before = deriveProjection({
      matching: [sub({ id: "sub_1", created: 1 }), sub({ id: "sub_2", created: 2 })],
    });
    expect(before.plan).toBe("PLUS");

    // sub_2 cancelled; sub_1 is still active.
    const after = deriveProjection({ matching: [sub({ id: "sub_1", created: 1 })] });
    expect(after.plan).toBe("PLUS");
    expect(after.canonicalId).toBe("sub_1");
  });

  it("drops to FREE only when the last entitled subscription is gone", () => {
    const after = deriveProjection({
      matching: [sub({ id: "sub_1", statusRaw: "canceled", created: 1 })],
    });
    expect(after.plan).toBe("FREE");
  });
});

describe("hasBlockingSubscription", () => {
  it("is true for a non-entitled but live subscription", () => {
    expect(hasBlockingSubscription([sub({ id: "s", statusRaw: "past_due" })])).toBe(true);
  });

  it("is false when every subscription is terminal", () => {
    expect(
      hasBlockingSubscription([
        sub({ id: "a", statusRaw: "canceled" }),
        sub({ id: "b", statusRaw: "incomplete_expired" }),
      ]),
    ).toBe(false);
  });
});
