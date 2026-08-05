import type { Metadata } from "next";
import { CompassPreview } from "@/components/onboarding/compass-preview";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { requireUser } from "@/features/auth/guards";
import { compassCompletion, getCompassProfile } from "@/features/onboarding/queries";
import { TOTAL_STEPS, parseStep } from "@/features/onboarding/schema";

export const metadata: Metadata = {
  title: "Build your compass",
  description: "Tell NorthStar enough about your situation to make its guidance specific.",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("/app/onboarding");
  const profile = await getCompassProfile(user.id);

  const params = await searchParams;
  const raw = params["step"];
  const requested = Array.isArray(raw) ? raw[0] : raw;

  /*
   * Resumption: with no explicit step, continue at the one after the furthest
   * completed. An explicit step is honoured so a user can go back and revise —
   * but is clamped to the next unstarted step, so nobody can skip ahead by URL.
   */
  const resumeAt = Math.min(profile.onboardingStep + 1, TOTAL_STEPS);
  const step = requested ? Math.min(parseStep(requested), resumeAt) : resumeAt;

  const completion = compassCompletion(profile);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <OnboardingForm step={step} profile={profile} />
        </div>

        <aside className="lg:col-span-5">
          <div className="lg:sticky lg:top-8">
            <CompassPreview profile={profile} completion={completion} />
            <p className="text-text-secondary mt-4 text-sm">
              Every field is optional and you can change any of it later. What you leave blank is
              reported as missing information rather than guessed at.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
