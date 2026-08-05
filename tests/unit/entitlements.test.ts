import { describe, expect, it } from "vitest";
import { currentPeriodKey, entitlementsForPlan } from "@/features/billing/entitlements";
import { EVENT_NAMES, stripPrivateProperties } from "@/features/analytics/event-names";
import { PLANS } from "@/features/billing/plans";

describe("entitlements", () => {
  it("gives Free the limits advertised on the pricing page", () => {
    const free = entitlementsForPlan("free");
    const advertised = PLANS.find((plan) => plan.id === "free");

    expect(free.monthlyReports).toBe(3);
    expect(free.maxActivePlans).toBe(1);
    expect(free.historyDays).toBe(30);
    // The pricing copy and the enforced limit must not drift apart.
    expect(advertised?.features.join(" ")).toContain("3 full insight reports");
  });

  it("gives Plus strictly more than Free on every dimension", () => {
    const free = entitlementsForPlan("free");
    const plus = entitlementsForPlan("plus");

    expect(plus.monthlyReports).toBeGreaterThan(free.monthlyReports);
    expect(plus.maxActivePlans).toBeGreaterThan(free.maxActivePlans);
    expect(plus.canExport).toBe(true);
    expect(plus.canUseAdvancedCompare).toBe(true);
    // Unlimited history is null, not a large number.
    expect(plus.historyDays).toBeNull();
  });

  it("never advertises unlimited reports, which the implementation could not honour", () => {
    expect(entitlementsForPlan("plus").monthlyReports).toBeLessThan(Number.POSITIVE_INFINITY);
    expect(Number.isFinite(entitlementsForPlan("plus").monthlyReports)).toBe(true);
  });
});

describe("usage period key", () => {
  it("formats as YYYY-MM in UTC", () => {
    expect(currentPeriodKey(new Date("2026-08-05T23:30:00Z"))).toBe("2026-08");
    expect(currentPeriodKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });

  it("zero-pads single-digit months so keys sort lexicographically", () => {
    expect(currentPeriodKey(new Date("2026-09-30T00:00:00Z"))).toBe("2026-09");
    expect(currentPeriodKey(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10");
    expect("2026-09" < "2026-10").toBe(true);
  });

  it("rolls over at the UTC month boundary, not the local one", () => {
    expect(currentPeriodKey(new Date("2026-08-31T23:59:59Z"))).toBe("2026-08");
    expect(currentPeriodKey(new Date("2026-09-01T00:00:00Z"))).toBe("2026-09");
  });
});

describe("analytics event names", () => {
  it("covers the funnel the spec lists", () => {
    for (const required of [
      "signup_completed",
      "onboarding_completed",
      "guidance_requested",
      "guidance_completed",
      "plan_created",
      "task_completed",
      "upgrade_started",
      "subscription_activated",
    ]) {
      expect(EVENT_NAMES).toContain(required);
    }
  });

  it("uses snake_case consistently", () => {
    expect(EVENT_NAMES.every((name) => /^[a-z]+(_[a-z]+)*$/.test(name))).toBe(true);
  });
});

describe("analytics privacy", () => {
  it("drops properties whose names suggest private content", () => {
    const safe = stripPrivateProperties({
      topic: "CAREER",
      criteriaCount: 3,
      question: "my private decision question",
      comment: "something personal",
      email: "a@b.co",
      notes: "private",
    });

    expect(safe).toEqual({ topic: "CAREER", criteriaCount: 3 });
  });

  it("keeps the analysable properties the funnel needs", () => {
    const safe = stripPrivateProperties({
      topic: "EDUCATION",
      latencyMs: 1200,
      includeProfile: true,
      code: "TIMEOUT",
    });

    expect(Object.keys(safe).sort()).toEqual(["code", "includeProfile", "latencyMs", "topic"]);
  });
});
