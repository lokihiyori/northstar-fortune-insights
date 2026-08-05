import { describe, expect, it } from "vitest";
import { SAMPLE_REPORTS } from "@/features/guidance/sample-data";
import { PLANS } from "@/features/billing/plans";

describe("sample reports", () => {
  it("offers three meaningfully distinct paths per report", () => {
    for (const report of SAMPLE_REPORTS) {
      expect(report.paths).toHaveLength(3);

      const labels = report.paths.map((path) => path.label);
      expect(new Set(labels).size).toBe(3);
    }
  });

  it("gives every path the full explainability anatomy", () => {
    for (const report of SAMPLE_REPORTS) {
      for (const path of report.paths) {
        expect(path.rationale.length).toBeGreaterThan(0);
        expect(path.tradeoffs.length).toBeGreaterThan(0);
        expect(path.changeConditions.length).toBeGreaterThan(0);
        expect(path.nextActions.length).toBeGreaterThan(0);
      }
    }
  });

  it("never presents an unsupported path as a strong fit", () => {
    // Spec section 9: with no evidence the result must be exploratory, not confident.
    for (const report of SAMPLE_REPORTS) {
      for (const path of report.paths) {
        if (path.evidence.length === 0) {
          expect(path.fit).toBe("EXPLORATORY");
        }
      }
    }
  });

  it("always pairs a confidence label with its reasons", () => {
    for (const report of SAMPLE_REPORTS) {
      expect(report.confidenceReasons.length).toBeGreaterThan(0);
    }
  });

  it("uses unique path ids within a report", () => {
    for (const report of SAMPLE_REPORTS) {
      const ids = report.paths.map((path) => path.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("plans", () => {
  it("offers exactly two plans, as the spec requires for clarity", () => {
    expect(PLANS).toHaveLength(2);
  });

  it("avoids advertising unlimited AI usage", () => {
    for (const plan of PLANS) {
      for (const feature of plan.features) {
        expect(feature.toLowerCase()).not.toMatch(/unlimited (ai|reports|insights)/);
      }
    }
  });
});
