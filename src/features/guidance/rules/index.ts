import type { GuidanceInput, Rule, RuleResult } from "./types";

/**
 * High-stakes topics NorthStar refuses to give personalized direction on
 * (spec section 12). Matched on the question text before anything is generated.
 */
const OUT_OF_SCOPE = [
  {
    pattern: /\b(diagnos\w*|symptom|medication|prescri\w+|therapy|self[- ]harm|suicid\w*)\b/i,
    area: "medical or mental-health",
  },
  {
    pattern: /\b(sue|lawsuit|litigat\w+|deportation|visa refusal|criminal charge)\b/i,
    area: "legal",
  },
  {
    pattern: /\b(which stocks?|invest in|portfolio allocation|crypto|should i buy shares)\b/i,
    area: "investment",
  },
] as const;

export const RULES: readonly Rule[] = [
  {
    id: "R001_QUESTION_SPECIFICITY",
    description: "The question must be specific enough to reason about.",
    evaluate: (input): RuleResult => {
      const words = input.question.trim().split(/\s+/).length;
      if (words < 6) {
        return {
          ruleId: "R001_QUESTION_SPECIFICITY",
          status: "warn",
          message: "The question is very short, so the analysis will be more general than usual.",
        };
      }
      return { ruleId: "R001_QUESTION_SPECIFICITY", status: "pass" };
    },
  },
  {
    id: "R002_HIGH_STAKES_BOUNDARY",
    description: "High-stakes medical, legal, or investment questions get a boundary, not advice.",
    evaluate: (input): RuleResult => {
      const match = OUT_OF_SCOPE.find((entry) => entry.pattern.test(input.question));
      if (match) {
        return {
          ruleId: "R002_HIGH_STAKES_BOUNDARY",
          status: "block",
          message: `This looks like a ${match.area} question. NorthStar does not give personalized direction on those — it will point you to the appropriate professional or official body instead.`,
        };
      }
      return { ruleId: "R002_HIGH_STAKES_BOUNDARY", status: "pass" };
    },
  },
  {
    id: "R003_REGION_KNOWN",
    description: "Region drives eligibility and labour data; without it confidence drops.",
    evaluate: (input): RuleResult => {
      if (!input.includeProfile || !input.profile.region) {
        return {
          ruleId: "R003_REGION_KNOWN",
          status: "warn",
          message: "No region was provided, so region-specific requirements cannot be checked.",
        };
      }
      return { ruleId: "R003_REGION_KNOWN", status: "pass" };
    },
  },
  {
    id: "R004_TIMEFRAME_KNOWN",
    description: "A missing timeframe makes path sequencing guesswork.",
    evaluate: (input): RuleResult => {
      if (!input.includeProfile || !input.profile.timeframe) {
        return {
          ruleId: "R004_TIMEFRAME_KNOWN",
          status: "warn",
          message: "No timeframe was provided, so paths are not ordered by urgency.",
        };
      }
      return { ruleId: "R004_TIMEFRAME_KNOWN", status: "pass" };
    },
  },
  {
    id: "R005_HARD_CONSTRAINTS_PRESENT",
    description: "Hard constraints must reach the model so no path violates them.",
    evaluate: (input): RuleResult => {
      const hard = input.constraints.filter((constraint) => constraint.isHard);
      if (hard.length === 0) {
        return {
          ruleId: "R005_HARD_CONSTRAINTS_PRESENT",
          status: "pass",
        };
      }
      return {
        ruleId: "R005_HARD_CONSTRAINTS_PRESENT",
        status: "pass",
        message: `${String(hard.length)} hard constraint(s) will be treated as non-negotiable.`,
      };
    },
  },
  {
    id: "R006_CRITERIA_CHOSEN",
    description: "At least one decision criterion is needed to order paths.",
    evaluate: (input): RuleResult => {
      if (input.criteria.length === 0) {
        return {
          ruleId: "R006_CRITERIA_CHOSEN",
          status: "warn",
          message: "No criteria were chosen, so paths are presented without a ranking.",
        };
      }
      return { ruleId: "R006_CRITERIA_CHOSEN", status: "pass" };
    },
  },
];

export function evaluateRules(input: GuidanceInput): RuleResult[] {
  return RULES.map((rule) => rule.evaluate(input));
}

export function isBlocked(results: readonly RuleResult[]): RuleResult | undefined {
  return results.find((result) => result.status === "block");
}

/**
 * Confidence is derived from rule warnings and evidence coverage, never asserted
 * by the model. Spec section 5.5: a confidence label must always come with the
 * reasons that produced it.
 */
export function deriveConfidence(
  results: readonly RuleResult[],
  evidenceCount: number,
): { basis: "HIGH_EVIDENCE" | "MISSING_INFORMATION" | "EXPLORATORY"; reasons: string[] } {
  const warnings = results.filter((result) => result.status === "warn");
  const reasons: string[] = [];

  if (evidenceCount === 0) {
    reasons.push("No reviewed source matched this question closely enough to cite");
  } else {
    reasons.push(`${String(evidenceCount)} passage(s) from reviewed sources matched this question`);
  }

  for (const warning of warnings) {
    if (warning.message) reasons.push(warning.message);
  }

  if (evidenceCount === 0) {
    return { basis: "EXPLORATORY", reasons };
  }
  if (warnings.length > 0) {
    return { basis: "MISSING_INFORMATION", reasons };
  }
  return { basis: "HIGH_EVIDENCE", reasons };
}

/** Turns warnings into the report's "what we still do not know" list. */
export function missingInformationFrom(results: readonly RuleResult[]): string[] {
  return results
    .filter((result) => result.status === "warn" && result.message)
    .map((result) => result.message!);
}
