"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { fieldErrorsFrom } from "@/lib/api/response";
import {
  CONSTRAINT_FIELDS,
  TOTAL_STEPS,
  parseStep,
  stepFourSchema,
  stepOneSchema,
  stepThreeSchema,
  stepTwoSchema,
} from "./schema";
import type {
  CareerStage,
  ConstraintType,
  GoalTimeframe,
  PriorityKey,
} from "@/generated/prisma/enums";

export type OnboardingFormState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

const INVALID: OnboardingFormState = {
  status: "error",
  message: "Check the highlighted fields and try again.",
};

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function toRecord(formData: FormData, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((key) => [key, readString(formData, key)]));
}

/**
 * Records progress without moving it backwards — a user revisiting step 2 after
 * finishing step 4 must not lose their completed state.
 */
async function recordProgress(userId: string, step: number): Promise<void> {
  const profile = await prisma.userProfile.findUniqueOrThrow({
    where: { userId },
    select: { onboardingStep: true, onboardingCompletedAt: true },
  });

  const data: { onboardingStep?: number; onboardingCompletedAt?: Date } = {};
  if (step > profile.onboardingStep) data.onboardingStep = step;
  if (step >= TOTAL_STEPS && !profile.onboardingCompletedAt) {
    data.onboardingCompletedAt = new Date();
  }

  if (Object.keys(data).length > 0) {
    await prisma.userProfile.update({ where: { userId }, data });
  }
}

async function saveStepOne(
  userId: string,
  formData: FormData,
): Promise<OnboardingFormState | null> {
  const parsed = stepOneSchema.safeParse(
    toRecord(formData, ["region", "careerStage", "currentRole"]),
  );
  if (!parsed.success) return { ...INVALID, fieldErrors: fieldErrorsFrom(parsed.error) };

  await prisma.userProfile.update({
    where: { userId },
    data: {
      region: parsed.data.region ?? null,
      careerStage: (parsed.data.careerStage as CareerStage | undefined) ?? null,
      currentRole: parsed.data.currentRole ?? null,
    },
  });
  return null;
}

async function saveStepTwo(
  userId: string,
  formData: FormData,
): Promise<OnboardingFormState | null> {
  const parsed = stepTwoSchema.safeParse(toRecord(formData, ["primaryGoal", "timeframe"]));
  if (!parsed.success) return { ...INVALID, fieldErrors: fieldErrorsFrom(parsed.error) };

  await prisma.userProfile.update({
    where: { userId },
    data: {
      primaryGoal: parsed.data.primaryGoal ?? null,
      timeframe: (parsed.data.timeframe as GoalTimeframe | undefined) ?? null,
    },
  });
  return null;
}

async function saveStepThree(
  userId: string,
  formData: FormData,
): Promise<OnboardingFormState | null> {
  const parsed = stepThreeSchema.safeParse(
    toRecord(formData, ["priority1", "priority2", "priority3"]),
  );
  if (!parsed.success) return { ...INVALID, fieldErrors: fieldErrorsFrom(parsed.error) };

  const ranked = [parsed.data.priority1, parsed.data.priority2, parsed.data.priority3]
    .map((key, index) => ({ key: key as PriorityKey | undefined, rank: index + 1 }))
    .filter((item): item is { key: PriorityKey; rank: number } => Boolean(item.key));

  // Replaced wholesale inside a transaction: the (userId, rank) unique
  // constraint makes an incremental update prone to transient collisions.
  await prisma.$transaction([
    prisma.userPriority.deleteMany({ where: { userId } }),
    prisma.userPriority.createMany({
      data: ranked.map((item) => ({ userId, key: item.key, rank: item.rank })),
    }),
  ]);
  return null;
}

async function saveStepFour(
  userId: string,
  formData: FormData,
): Promise<OnboardingFormState | null> {
  const keys = [...CONSTRAINT_FIELDS.map((field) => field.name), "notes"];
  const parsed = stepFourSchema.safeParse(toRecord(formData, keys));
  if (!parsed.success) return { ...INVALID, fieldErrors: fieldErrorsFrom(parsed.error) };

  const entries = CONSTRAINT_FIELDS.map((field) => ({
    type: field.type as ConstraintType,
    value: parsed.data[field.name as keyof typeof parsed.data],
  })).filter((entry): entry is { type: ConstraintType; value: string } => Boolean(entry.value));

  await prisma.$transaction([
    prisma.userConstraint.deleteMany({ where: { userId } }),
    prisma.userConstraint.createMany({
      data: entries.map((entry) => ({
        userId,
        type: entry.type,
        value: entry.value,
        // Authorization is hard: a path that violates it is not merely
        // suboptimal, it is unusable.
        isHardConstraint: entry.type === "WORK_AUTHORIZATION",
      })),
    }),
    prisma.userProfile.update({
      where: { userId },
      data: { notes: parsed.data.notes ?? null },
    }),
  ]);
  return null;
}

export async function saveOnboardingStep(
  _previous: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const user = await requireUser("/app/onboarding");
  const step = parseStep(readString(formData, "step"));

  // Every step is skippable (spec section 4), so skipping still advances.
  if (readString(formData, "intent") !== "skip") {
    const failure =
      step === 1
        ? await saveStepOne(user.id, formData)
        : step === 2
          ? await saveStepTwo(user.id, formData)
          : step === 3
            ? await saveStepThree(user.id, formData)
            : await saveStepFour(user.id, formData);

    if (failure) return failure;
  }

  await recordProgress(user.id, step);
  revalidatePath("/app/onboarding");

  // redirect throws, so nothing after this runs.
  redirect(step >= TOTAL_STEPS ? "/app" : `/app/onboarding?step=${String(step + 1)}`);
}
