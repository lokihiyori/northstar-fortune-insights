import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { getSessionUser } from "@/features/auth/guards";
import { isGoogleConfigured } from "@/features/auth/providers";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Create a NorthStar account and build your compass.",
};

export default async function SignUpPage() {
  if (await getSessionUser()) redirect("/app");

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Find your next step</h1>
      <p className="text-text-secondary mt-2 text-sm">
        Three free reports a month. We ask only for what makes the guidance better.
      </p>

      <div className="border-border bg-surface rounded-card mt-8 border p-6">
        <SignUpForm />

        {isGoogleConfigured() ? (
          <>
            <div className="my-6 flex items-center gap-3">
              <span className="bg-border h-px flex-1" />
              <span className="text-text-secondary text-xs">or</span>
              <span className="bg-border h-px flex-1" />
            </div>
            <GoogleSignInButton callbackUrl="/app/onboarding" label="Continue with Google" />
          </>
        ) : null}
      </div>

      <p className="text-text-secondary mt-6 text-center text-sm">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-brand-teal font-medium hover:underline">
          Sign in
        </Link>
      </p>

      <p className="text-text-secondary mt-6 text-center text-xs">
        By creating an account you agree to our{" "}
        <Link href="/terms" className="underline">
          terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline">
          privacy policy
        </Link>
        .
      </p>
    </div>
  );
}
