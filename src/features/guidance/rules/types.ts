import type { CriterionKey } from "@/features/guidance/composer";
import type { Topic } from "@/features/guidance/types";

/**
 * Rules are pure functions with stable IDs (spec section 9). Deterministic code
 * — not the model — owns constraints, conflicts, and confidence. Each rule is
 * independently testable and its ID appears in the report's audit trail.
 */
export type RuleStatus = "pass" | "warn" | "block";

export type RuleResult = {
  ruleId: string;
  status: RuleStatus;
  message?: string;
  affectedPathIds?: string[];
};

export type NormalizedConstraint = {
  id: string;
  type: "TIME" | "BUDGET" | "WORK_AUTHORIZATION" | "RESPONSIBILITIES" | "ACCESSIBILITY" | "OTHER";
  value: string;
  isHard: boolean;
};

export type GuidanceInput = {
  topic: Topic;
  question: string;
  criteria: Array<{ key: CriterionKey; weight: number }>;
  profile: {
    region: string | null;
    careerStage: string | null;
    currentRole: string | null;
    primaryGoal: string | null;
    timeframe: string | null;
  };
  constraints: NormalizedConstraint[];
  includeProfile: boolean;
};

export type Rule = {
  id: string;
  description: string;
  evaluate: (input: GuidanceInput) => RuleResult;
};
