import { describe, expect, it } from "vitest";
import {
  RULES,
  deriveConfidence,
  evaluateRules,
  isBlocked,
  missingInformationFrom,
} from "@/features/guidance/rules";
import type { GuidanceInput } from "@/features/guidance/rules/types";

function makeInput(overrides: Partial<GuidanceInput> = {}): GuidanceInput {
  return {
    topic: "CAREER",
    question: "Should I take the offer at the larger company or stay where I am?",
    criteria: [{ key: "STABILITY", weight: 4 }],
    profile: {
      region: "Halifax, Nova Scotia",
      careerStage: "MID_CAREER",
      currentRole: "Analyst",
      primaryGoal: "More stability",
      timeframe: "WITHIN_6_MONTHS",
    },
    constraints: [],
    includeProfile: true,
    ...overrides,
  };
}

describe("rule engine", () => {
  it("gives every rule a unique, stable id", () => {
    const ids = RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^R\d{3}_[A-Z_]+$/.test(id))).toBe(true);
  });

  it("passes a complete, in-scope request", () => {
    const results = evaluateRules(makeInput());
    expect(isBlocked(results)).toBeUndefined();
    expect(results.every((result) => result.status === "pass")).toBe(true);
  });

  it("blocks medical questions rather than answering them", () => {
    const results = evaluateRules(
      makeInput({ question: "What medication should I take for my symptoms?" }),
    );
    const blocked = isBlocked(results);

    expect(blocked?.ruleId).toBe("R002_HIGH_STAKES_BOUNDARY");
    expect(blocked?.message).toContain("medical");
  });

  it("blocks legal and investment questions too", () => {
    for (const question of [
      "Should I sue my former employer over this?",
      "Which stocks should I invest in with my savings?",
    ]) {
      expect(isBlocked(evaluateRules(makeInput({ question })))?.ruleId).toBe(
        "R002_HIGH_STAKES_BOUNDARY",
      );
    }
  });

  it("warns rather than blocks when region is unknown", () => {
    const results = evaluateRules(makeInput({ profile: { ...makeInput().profile, region: null } }));

    expect(isBlocked(results)).toBeUndefined();
    expect(results.find((r) => r.ruleId === "R003_REGION_KNOWN")?.status).toBe("warn");
  });

  it("treats withheld profile context as missing information", () => {
    const results = evaluateRules(makeInput({ includeProfile: false }));
    const missing = missingInformationFrom(results);

    expect(missing.length).toBeGreaterThan(0);
    expect(missing.join(" ")).toContain("region");
  });
});

describe("confidence derivation", () => {
  it("is exploratory when nothing was retrieved, whatever the rules said", () => {
    const { basis, reasons } = deriveConfidence(evaluateRules(makeInput()), 0);

    expect(basis).toBe("EXPLORATORY");
    expect(reasons.length).toBeGreaterThan(0);
  });

  it("is high only with evidence and no warnings", () => {
    expect(deriveConfidence(evaluateRules(makeInput()), 5).basis).toBe("HIGH_EVIDENCE");
  });

  it("drops to missing-information when a rule warned", () => {
    const results = evaluateRules(makeInput({ includeProfile: false }));
    expect(deriveConfidence(results, 5).basis).toBe("MISSING_INFORMATION");
  });

  it("always returns at least one reason, so a label is never bare", () => {
    // Spec section 5.5: never show confidence without its basis.
    for (const count of [0, 1, 9]) {
      expect(deriveConfidence(evaluateRules(makeInput()), count).reasons.length).toBeGreaterThan(0);
    }
  });
});
