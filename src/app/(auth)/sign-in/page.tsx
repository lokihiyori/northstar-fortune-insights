import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { getSessionUser } from "@/features/auth/guards";
import { isGoogleConfigured } from "@/features/auth/providers";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your NorthStar account.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await getSessionUser()) redirect("/app");

  const params = await searchParams;
  const raw = params["callbackUrl"];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  // Only same-origin paths survive; anything else falls back to /app.
  const callbackUrl =
    candidate && candidate.startsWith("/") && !candidate.startsWith("//") ? candidate : "/app";

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="text-text-secondary mt-2 text-sm">
        Sign in to pick up your paths and plans where you left them.
      </p>

      <div className="border-border bg-surface rounded-card mt-8 border p-6">
        <SignInForm callbackUrl={callbackUrl} />

        {isGoogleConfigured() ? (
          <>
            <div className="my-6 flex items-center gap-3">
              <span className="bg-border h-px flex-1" />
              <span className="text-text-secondary text-xs">or</span>
              <span className="bg-border h-px flex-1" />
            </div>
            <GoogleSignInButton callbackUrl={callbackUrl} />
          </>
        ) : null}
      </div>

      <p className="text-text-secondary mt-6 text-center text-sm">
        New to NorthStar?{" "}
        <Link href="/sign-up" className="text-brand-teal font-medium hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
