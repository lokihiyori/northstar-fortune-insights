import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { CompassPreview } from "@/components/onboarding/compass-preview";
import { requireUser } from "@/features/auth/guards";
import { compassCompletion, getCompassProfile } from "@/features/onboarding/queries";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const user = await requireUser("/app");
  const profile = await getCompassProfile(user.id);

  // A brand-new account has nothing to show, so send it to onboarding rather
  // than to an empty dashboard.
  if (!profile.onboardingCompletedAt && profile.onboardingStep === 0) {
    redirect("/app/onboarding");
  }

  const completion = compassCompletion(profile);
  const firstName = user.name?.split(" ")[0] ?? null;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
      </h1>
      <p className="text-text-secondary mt-2">
        Your compass shapes every recommendation. The guidance workspace arrives in the next phase.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          {!profile.onboardingCompletedAt ? (
            <Card raised>
              <CardTitle>Finish building your compass</CardTitle>
              <CardBody className="mt-2">
                You are {completion}% of the way there. The more NorthStar knows about your
                constraints, the fewer assumptions it has to make.
              </CardBody>
              <ButtonLink href="/app/onboarding" className="mt-5">
                Continue setup
              </ButtonLink>
            </Card>
          ) : (
            <Card>
              <CardTitle>Your compass is set</CardTitle>
              <CardBody className="mt-2">
                Asking your first question opens in Phase 3. Until then you can revise your compass
                at any time, and nothing you have entered is used for anything else.
              </CardBody>
              <Link
                href="/app/onboarding?step=1"
                className="text-brand-teal mt-5 inline-block text-sm font-medium hover:underline"
              >
                Review your answers
              </Link>
            </Card>
          )}

          <Card>
            <CardTitle>What comes next</CardTitle>
            <CardBody className="mt-2">
              Phase 3 adds the guided question composer, the full insight report, and scenario
              comparison. Phase 4 connects the guidance engine behind them.
            </CardBody>
          </Card>
        </div>

        <aside className="lg:col-span-5">
          <CompassPreview profile={profile} completion={completion} />
        </aside>
      </div>
    </div>
  );
}
