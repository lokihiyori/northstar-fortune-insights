import { z } from "zod";

export const TOTAL_STEPS = 4;

export const CAREER_STAGES = [
  { value: "STUDENT", label: "Student" },
  { value: "RECENT_GRADUATE", label: "Recent graduate" },
  { value: "EARLY_CAREER", label: "Early career" },
  { value: "MID_CAREER", label: "Mid career" },
  { value: "SENIOR", label: "Senior or leadership" },
  { value: "CAREER_CHANGE", label: "Changing fields" },
  { value: "RETURNING", label: "Returning to work" },
] as const;

export const TIMEFRAMES = [
  { value: "WITHIN_3_MONTHS", label: "Within 3 months" },
  { value: "WITHIN_6_MONTHS", label: "Within 6 months" },
  { value: "WITHIN_1_YEAR", label: "Within a year" },
  { value: "WITHIN_2_YEARS", label: "Within two years" },
  { value: "EXPLORING", label: "Still exploring" },
] as const;

export const PRIORITIES = [
  { value: "INCOME", label: "Income" },
  { value: "STABILITY", label: "Stability" },
  { value: "FLEXIBILITY", label: "Flexibility" },
  { value: "LEARNING", label: "Learning" },
  { value: "IMPACT", label: "Impact" },
  { value: "LOCATION", label: "Location" },
  { value: "SPEED", label: "Speed" },
] as const;

export const CONSTRAINT_FIELDS = [
  {
    type: "TIME",
    name: "constraintTime",
    label: "Time available",
    placeholder: "About 5 hours a week outside work",
  },
  {
    type: "BUDGET",
    name: "constraintBudget",
    label: "Budget",
    placeholder: "Up to $3,000 for training",
  },
  {
    type: "WORK_AUTHORIZATION",
    name: "constraintAuthorization",
    label: "Work authorization",
    placeholder: "Permanent resident, no restriction",
  },
  {
    type: "RESPONSIBILITIES",
    name: "constraintResponsibilities",
    label: "Responsibilities",
    placeholder: "Two young children, limited evenings",
  },
  {
    type: "ACCESSIBILITY",
    name: "constraintAccessibility",
    label: "Accessibility needs",
    placeholder: "Anything NorthStar should account for",
  },
] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

/**
 * An unselected `<select>` submits an empty string, not an absent key, so the
 * empty case has to be mapped to undefined before the enum sees it. Without
 * this, choosing "No preference" fails validation.
 */
const optionalEnum = (values: readonly string[]) =>
  z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.enum(values as [string, ...string[]]).optional(),
  );

export const stepOneSchema = z.object({
  region: optionalText(120),
  careerStage: optionalEnum(CAREER_STAGES.map((stage) => stage.value)),
  currentRole: optionalText(160),
});

export const stepTwoSchema = z.object({
  primaryGoal: optionalText(400),
  timeframe: optionalEnum(TIMEFRAMES.map((frame) => frame.value)),
});

const priorityValues = PRIORITIES.map((priority) => priority.value);

export const stepThreeSchema = z
  .object({
    priority1: optionalEnum(priorityValues),
    priority2: optionalEnum(priorityValues),
    priority3: optionalEnum(priorityValues),
  })
  .superRefine((value, ctx) => {
    const chosen = [value.priority1, value.priority2, value.priority3].filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );

    // Ranking the same priority twice makes the ordering meaningless.
    if (new Set(chosen).size !== chosen.length) {
      ctx.addIssue({
        code: "custom",
        path: ["priority1"],
        message: "Choose a different priority for each rank.",
      });
    }
  });

export const stepFourSchema = z.object({
  constraintTime: optionalText(200),
  constraintBudget: optionalText(200),
  constraintAuthorization: optionalText(200),
  constraintResponsibilities: optionalText(200),
  constraintAccessibility: optionalText(200),
  notes: optionalText(1000),
});

export const STEP_SCHEMAS = {
  1: stepOneSchema,
  2: stepTwoSchema,
  3: stepThreeSchema,
  4: stepFourSchema,
} as const;

export function parseStep(value: string | undefined): number {
  const step = Number(value);
  if (!Number.isInteger(step) || step < 1 || step > TOTAL_STEPS) return 1;
  return step;
}
