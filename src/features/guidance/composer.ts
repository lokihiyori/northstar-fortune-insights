import { z } from "zod";
import type { Topic } from "./types";

export const TOPICS: ReadonlyArray<{ value: Topic; label: string; blurb: string }> = [
  {
    value: "CAREER",
    label: "Career",
    blurb: "Roles, industries, offers, and upskilling decisions.",
  },
  {
    value: "EDUCATION",
    label: "Education",
    blurb: "Programs, credentials, and whether more study is worth it.",
  },
  {
    value: "RELOCATION",
    label: "Relocation",
    blurb: "Moving province or country, and what it changes.",
  },
  {
    value: "PERSONAL_GOAL",
    label: "Personal goal",
    blurb: "A major goal you want a realistic plan for.",
  },
];

/** Spec section 5.3: topic-specific starters, not an empty chat box. */
export const QUESTION_STARTERS: Record<Topic, readonly string[]> = {
  CAREER: [
    "Which of these roles best fits my experience and priorities?",
    "What is the most realistic path from my current skills to ___?",
    "Compare staying in my current role with accepting a new opportunity.",
  ],
  EDUCATION: [
    "Is a formal credential worth it for the direction I want to go?",
    "Which program gets me to ___ fastest without wasting money?",
    "Can I get there through work experience instead of study?",
  ],
  RELOCATION: [
    "What would moving to ___ realistically change about my career?",
    "Which region best fits my work and my constraints?",
    "What do I need in place before relocating?",
  ],
  PERSONAL_GOAL: [
    "What is a realistic plan to reach ___ in the next year?",
    "What is most likely to stop me, and what can I do about it?",
    "How should I sequence this alongside my current commitments?",
  ],
};

export const DECISION_CRITERIA = [
  { key: "INCOME", label: "Income" },
  { key: "STABILITY", label: "Stability" },
  { key: "SPEED", label: "Speed to outcome" },
  { key: "FLEXIBILITY", label: "Flexibility" },
  { key: "LEARNING", label: "Learning" },
  { key: "IMPACT", label: "Impact" },
  { key: "LOCATION", label: "Location fit" },
  { key: "COST", label: "Cost" },
] as const;

export type CriterionKey = (typeof DECISION_CRITERIA)[number]["key"];

export const MAX_CRITERIA = 5;
export const MIN_QUESTION_LENGTH = 15;
export const MAX_QUESTION_LENGTH = 600;

const topicValues = TOPICS.map((topic) => topic.value) as [Topic, ...Topic[]];
const criterionValues = DECISION_CRITERIA.map((criterion) => criterion.key) as [
  CriterionKey,
  ...CriterionKey[],
];

export const composerSchema = z.object({
  topic: z.enum(topicValues),
  question: z
    .string()
    .trim()
    .min(MIN_QUESTION_LENGTH, "Add a little more detail so the analysis can be specific.")
    .max(MAX_QUESTION_LENGTH, "Please keep the question under 600 characters."),
  criteria: z
    .array(
      z.object({
        key: z.enum(criterionValues),
        // Weights are a coarse 1–5, not a false-precision percentage.
        weight: z.number().int().min(1).max(5),
      }),
    )
    .min(1, "Choose at least one thing that matters to you.")
    .max(MAX_CRITERIA, `Choose at most ${String(MAX_CRITERIA)}.`)
    .refine(
      (items) => new Set(items.map((item) => item.key)).size === items.length,
      "Each criterion can only be chosen once.",
    ),
  /** Profile fields the user has confirmed may be sent with this question. */
  includeProfile: z.boolean(),
});

export type ComposerInput = z.infer<typeof composerSchema>;

/** Spec section 5.4 — named stages, in order. Never a fake percentage. */
export const GENERATION_STAGES = [
  "Structuring your question",
  "Checking your priorities and constraints",
  "Retrieving relevant resources",
  "Comparing possible paths",
  "Validating the final insight",
] as const;

export type GenerationStage = (typeof GENERATION_STAGES)[number];
