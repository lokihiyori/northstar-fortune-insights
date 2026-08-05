import { describe, expect, it } from "vitest";
import {
  TOTAL_STEPS,
  parseStep,
  stepOneSchema,
  stepThreeSchema,
} from "@/features/onboarding/schema";

describe("parseStep", () => {
  it("accepts every valid step", () => {
    for (let step = 1; step <= TOTAL_STEPS; step += 1) {
      expect(parseStep(String(step))).toBe(step);
    }
  });

  it("falls back to step 1 for anything out of range or unparseable", () => {
    for (const input of [undefined, "", "0", "-1", "99", "abc", "2.5"]) {
      expect(parseStep(input)).toBe(1);
    }
  });
});

describe("stepOneSchema", () => {
  it("treats empty strings as absent rather than storing blanks", () => {
    const result = stepOneSchema.parse({ region: "   ", careerStage: "", currentRole: "" });
    expect(result.region).toBeUndefined();
    expect(result.currentRole).toBeUndefined();
  });

  it("accepts a fully blank step, because every step is skippable", () => {
    expect(stepOneSchema.safeParse({}).success).toBe(true);
  });

  it("rejects an unknown career stage", () => {
    expect(stepOneSchema.safeParse({ careerStage: "ASTRONAUT" }).success).toBe(false);
  });
});

describe("stepThreeSchema", () => {
  it("accepts a partial ranking", () => {
    expect(stepThreeSchema.safeParse({ priority1: "INCOME" }).success).toBe(true);
  });

  it("rejects the same priority ranked twice", () => {
    const result = stepThreeSchema.safeParse({ priority1: "INCOME", priority2: "INCOME" });
    expect(result.success).toBe(false);
  });

  it("accepts three distinct priorities", () => {
    const result = stepThreeSchema.safeParse({
      priority1: "INCOME",
      priority2: "STABILITY",
      priority3: "LEARNING",
    });
    expect(result.success).toBe(true);
  });
});
