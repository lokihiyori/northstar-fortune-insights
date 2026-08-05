/**
 * Presentation types for a guidance report. These mirror the structured response
 * contract in spec section 9 — Phase 4 adds the Zod schema that validates real
 * model output into this shape. Until then they type the static sample data.
 */

export type PathLabel = "BEST_FIT" | "LOWER_RISK" | "GROWTH";
export type Fit = "STRONG" | "MODERATE" | "EXPLORATORY";
export type Topic = "CAREER" | "EDUCATION" | "RELOCATION" | "PERSONAL_GOAL";

export const PATH_LABEL_COPY: Record<PathLabel, string> = {
  BEST_FIT: "Best overall fit",
  LOWER_RISK: "Lower-risk alternative",
  GROWTH: "Growth option",
};

// Spec section 5.5: a qualitative band, never a fabricated percentage.
export const FIT_COPY: Record<Fit, string> = {
  STRONG: "Strong",
  MODERATE: "Moderate",
  EXPLORATORY: "Exploratory",
};

export const TOPIC_COPY: Record<Topic, string> = {
  CAREER: "Career",
  EDUCATION: "Education",
  RELOCATION: "Relocation",
  PERSONAL_GOAL: "Personal goal",
};

export type EvidenceItem = {
  sourceId: string;
  claim: string;
  publisher: string;
  region: string;
  url: string;
};

export type NextAction = {
  title: string;
  description: string;
  targetDays: number;
};

export type RecommendationPath = {
  id: string;
  label: PathLabel;
  title: string;
  fit: Fit;
  timeHorizon: string;
  mainTradeoff: string;
  rationale: string[];
  assumptions: string[];
  tradeoffs: string[];
  changeConditions: string[];
  evidence: EvidenceItem[];
  nextActions: NextAction[];
  /** Which of the user's stated constraints this path connects to. */
  supportingConstraintIds: string[];
};

export type ConfidenceBasis = "HIGH_EVIDENCE" | "MISSING_INFORMATION" | "EXPLORATORY";

export const CONFIDENCE_COPY: Record<ConfidenceBasis, string> = {
  HIGH_EVIDENCE: "High evidence coverage",
  MISSING_INFORMATION: "Some missing information",
  EXPLORATORY: "Exploratory recommendation",
};

export type SampleProfile = {
  id: string;
  name: string;
  headline: string;
  region: string;
  careerStage: string;
  constraints: Array<{ id: string; label: string }>;
  priorities: string[];
};

export type SampleReport = {
  id: string;
  profile: SampleProfile;
  topic: Topic;
  question: string;
  summary: string;
  confidenceBasis: ConfidenceBasis;
  confidenceReasons: string[];
  missingInformation: string[];
  paths: RecommendationPath[];
  disclaimer: string;
};
