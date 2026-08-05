import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { CareerStage, GoalTimeframe, PriorityKey } from "@/generated/prisma/enums";

export type CompassProfile = {
  region: string | null;
  careerStage: CareerStage | null;
  currentRole: string | null;
  primaryGoal: string | null;
  timeframe: GoalTimeframe | null;
  notes: string | null;
  onboardingStep: number;
  onboardingCompletedAt: Date | null;
  priorities: Array<{ key: PriorityKey; rank: number }>;
  constraints: Array<{ id: string; type: string; value: string }>;
};

/**
 * Reads the compass for a user, creating the profile row if it is missing.
 * OAuth sign-ups arrive through the adapter, which does not know about our
 * profile table, so the row cannot be assumed to exist.
 */
export async function getCompassProfile(userId: string): Promise<CompassProfile> {
  const profile = await prisma.userProfile.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

  const [priorities, constraints] = await Promise.all([
    prisma.userPriority.findMany({
      where: { userId },
      orderBy: { rank: "asc" },
      select: { key: true, rank: true },
    }),
    prisma.userConstraint.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true, value: true },
    }),
  ]);

  return {
    region: profile.region,
    careerStage: profile.careerStage,
    currentRole: profile.currentRole,
    primaryGoal: profile.primaryGoal,
    timeframe: profile.timeframe,
    notes: profile.notes,
    onboardingStep: profile.onboardingStep,
    onboardingCompletedAt: profile.onboardingCompletedAt,
    priorities,
    constraints,
  };
}

/** Rough completeness, used for the live compass preview. */
export function compassCompletion(profile: CompassProfile): number {
  const signals = [
    Boolean(profile.region),
    Boolean(profile.careerStage),
    Boolean(profile.primaryGoal),
    Boolean(profile.timeframe),
    profile.priorities.length > 0,
    profile.constraints.length > 0,
  ];

  const filled = signals.filter(Boolean).length;
  return Math.round((filled / signals.length) * 100);
}
