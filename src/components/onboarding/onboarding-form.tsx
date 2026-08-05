"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/ui/field";
import { saveOnboardingStep, type OnboardingFormState } from "@/features/onboarding/actions";
import {
  CAREER_STAGES,
  CONSTRAINT_FIELDS,
  PRIORITIES,
  TIMEFRAMES,
  TOTAL_STEPS,
} from "@/features/onboarding/schema";
import type { CompassProfile } from "@/features/onboarding/queries";

const INITIAL: OnboardingFormState = { status: "idle" };

const STEP_COPY = [
  {
    title: "Where are you now?",
    description:
      "Location matters because eligibility rules, credential recognition, and demand are all regional.",
  },
  {
    title: "Where do you want to go?",
    description:
      "One goal is enough. You can be uncertain about it — say so and we will account for it.",
  },
  {
    title: "What matters most?",
    description:
      "Rank up to three. This changes how paths are ordered, and the report will always show you the ranking it used.",
  },
  {
    title: "What should NorthStar consider?",
    description:
      "Constraints are the difference between advice that sounds good and advice you can actually follow. Every field is optional.",
  },
] as const;

function Select({
  id,
  name,
  label,
  hint,
  options,
  defaultValue,
  errors,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string | undefined;
  options: readonly { value: string; label: string }[];
  defaultValue?: string | null | undefined;
  errors?: string[] | undefined;
}) {
  const errorId = errors && errors.length > 0 ? `${id}-error` : undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {hint ? <p className="text-text-secondary mt-1 text-sm">{hint}</p> : null}
      <select
        id={id}
        name={name}
        defaultValue={defaultValue ?? ""}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
        className="rounded-control border-border bg-surface mt-1.5 h-11 w-full border px-3 text-base sm:text-sm"
      >
        <option value="">No preference</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {errorId ? (
        <ul id={errorId} className="mt-1.5 space-y-1">
          {errors?.map((error) => (
            <li key={error} className="text-danger flex gap-1.5 text-sm">
              <span aria-hidden="true">&#9888;</span>
              {error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Actions({ step }: { step: number }) {
  const { pending } = useFormStatus();
  const last = step >= TOTAL_STEPS;

  return (
    <div className="border-border mt-8 flex flex-wrap items-center gap-3 border-t pt-6">
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : last ? "Finish" : "Save and continue"}
      </Button>

      <Button type="submit" name="intent" value="skip" variant="ghost" size="lg" disabled={pending}>
        Skip this step
      </Button>

      {step > 1 ? (
        <Link
          href={`/app/onboarding?step=${String(step - 1)}`}
          className="text-text-secondary hover:text-text-primary ml-auto text-sm"
        >
          Back
        </Link>
      ) : null}
    </div>
  );
}

export function OnboardingForm({ step, profile }: { step: number; profile: CompassProfile }) {
  const [state, formAction] = useActionState(saveOnboardingStep, INITIAL);
  const copy = STEP_COPY[step - 1] ?? STEP_COPY[0];
  const errors = state.fieldErrors;

  const priorityAt = (rank: number) =>
    profile.priorities.find((item) => item.rank === rank)?.key ?? "";

  const constraintFor = (type: string) =>
    profile.constraints.find((item) => item.type === type)?.value ?? "";

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="step" value={step} />

      <div>
        <p className="text-brand-teal text-sm font-semibold">
          Step {step} of {TOTAL_STEPS}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-text-secondary mt-2">{copy.description}</p>
      </div>

      {state.message ? (
        <div className="mt-6">
          <FormMessage>{state.message}</FormMessage>
        </div>
      ) : null}

      <div className="mt-8 space-y-6">
        {step === 1 ? (
          <>
            <Field
              id="region"
              name="region"
              label="Country, province, or city"
              hint="For example: Toronto, Ontario"
              defaultValue={profile.region ?? ""}
              errors={errors?.["region"]}
            />
            <Select
              id="careerStage"
              name="careerStage"
              label="Where you are in your career"
              options={CAREER_STAGES}
              defaultValue={profile.careerStage}
              errors={errors?.["careerStage"]}
            />
            <Field
              id="currentRole"
              name="currentRole"
              label="Current role or field of study"
              defaultValue={profile.currentRole ?? ""}
              errors={errors?.["currentRole"]}
            />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div>
              <label htmlFor="primaryGoal" className="block text-sm font-medium">
                Your main goal
              </label>
              <p className="text-text-secondary mt-1 text-sm">
                A sentence is plenty. &ldquo;Work in my field here within a year&rdquo; is a good
                goal.
              </p>
              <textarea
                id="primaryGoal"
                name="primaryGoal"
                rows={4}
                defaultValue={profile.primaryGoal ?? ""}
                className="rounded-control border-border bg-surface mt-1.5 w-full border px-3.5 py-2.5 text-base sm:text-sm"
              />
            </div>
            <Select
              id="timeframe"
              name="timeframe"
              label="When would you like to get there?"
              options={TIMEFRAMES}
              defaultValue={profile.timeframe}
              errors={errors?.["timeframe"]}
            />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Select
              id="priority1"
              name="priority1"
              label="Most important"
              options={PRIORITIES}
              defaultValue={priorityAt(1)}
              errors={errors?.["priority1"]}
            />
            <Select
              id="priority2"
              name="priority2"
              label="Second"
              options={PRIORITIES}
              defaultValue={priorityAt(2)}
              errors={errors?.["priority2"]}
            />
            <Select
              id="priority3"
              name="priority3"
              label="Third"
              options={PRIORITIES}
              defaultValue={priorityAt(3)}
              errors={errors?.["priority3"]}
            />
          </>
        ) : null}

        {step === 4 ? (
          <>
            {CONSTRAINT_FIELDS.map((field) => (
              <Field
                key={field.name}
                id={field.name}
                name={field.name}
                label={field.label}
                placeholder={field.placeholder}
                defaultValue={constraintFor(field.type)}
                errors={errors?.[field.name]}
              />
            ))}

            <div>
              <label htmlFor="notes" className="block text-sm font-medium">
                Anything else
              </label>
              <p className="text-text-secondary mt-1 text-sm">
                Do not include health records, financial account numbers, or government identifiers.
              </p>
              <textarea
                id="notes"
                name="notes"
                rows={4}
                defaultValue={profile.notes ?? ""}
                className="rounded-control border-border bg-surface mt-1.5 w-full border px-3.5 py-2.5 text-base sm:text-sm"
              />
            </div>
          </>
        ) : null}
      </div>

      <Actions step={step} />
    </form>
  );
}
