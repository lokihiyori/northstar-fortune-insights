import type { Metadata } from "next";
import { CompassPreview } from "@/components/onboarding/compass-preview";
import { ButtonLink } from "@/components/ui/button";
import { requireUser } from "@/features/auth/guards";
import { compassCompletion, getCompassProfile } from "@/features/onboarding/queries";

export const metadata: Metadata = { title: "Your compass" };

export default async function ProfilePage() {
  const user = await requireUser("/app/profile");
  const profile = await getCompassProfile(user.id);
  const completion = compassCompletion(profile);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Your compass</h1>
      <p className="text-text-secondary mt-2 max-w-2xl">
        This is the context sent with every question you ask. Anything left blank is reported as
        missing information rather than guessed at.
      </p>

      <div className="mt-8">
        <CompassPreview profile={profile} completion={completion} />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href="/app/onboarding?step=1">Edit your compass</ButtonLink>
        <ButtonLink href="/app/ask" variant="secondary">
          Ask a question
        </ButtonLink>
      </div>

      <section aria-labelledby="privacy-heading" className="border-border mt-12 border-t pt-8">
        <h2 id="privacy-heading" className="text-lg font-semibold tracking-tight">
          What leaves your account
        </h2>
        <p className="text-text-secondary mt-2 text-sm">
          When you generate an insight, the fields above and your question are sent to the AI
          provider along with passages from reviewed public sources. Your email address and account
          identifier are not. You can turn the compass context off for any individual question on
          the review step before generating.
        </p>
      </section>
    </div>
  );
}
