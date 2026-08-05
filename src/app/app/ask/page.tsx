import type { Metadata } from "next";
import { QuestionComposer, type ComposerContext } from "@/components/composer/question-composer";
import { requireUser } from "@/features/auth/guards";
import { getEntitlements } from "@/features/billing/entitlements";
import { countReportsThisPeriod } from "@/features/guidance/usage";
import { getCompassProfile } from "@/features/onboarding/queries";
import { CAREER_STAGES, TIMEFRAMES } from "@/features/onboarding/schema";

export const metadata: Metadata = {
  title: "Ask",
  description: "Turn an uncertain question into a structured decision.",
};

function label(options: readonly { value: string; label: string }[], value: string | null) {
  if (!value) return null;
  return options.find((option) => option.value === value)?.label ?? null;
}

export default async function AskPage() {
  const user = await requireUser("/app/ask");
  const [profile, entitlements, used] = await Promise.all([
    getCompassProfile(user.id),
    getEntitlements(user.id),
    countReportsThisPeriod(user.id),
  ]);

  const context: ComposerContext = {
    region: profile.region,
    careerStage: label(CAREER_STAGES, profile.careerStage),
    currentRole: profile.currentRole,
    primaryGoal: profile.primaryGoal,
    timeframe: label(TIMEFRAMES, profile.timeframe),
    constraints: profile.constraints.map((constraint) => ({
      id: constraint.id,
      label: constraint.value,
    })),
  };

  return (
    <div className="mx-auto max-w-3xl">
      <QuestionComposer
        context={context}
        reportsRemaining={Math.max(0, entitlements.monthlyReports - used)}
      />
    </div>
  );
}
