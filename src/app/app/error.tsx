"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

/**
 * Route-level error boundary. Shows the digest rather than the message: Next
 * redacts server error messages in production anyway, and the digest is what
 * correlates to the server log without exposing internals to the user.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App route error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl py-8">
      <ErrorState
        title="We could not load this page"
        description={
          <>
            <p>
              This is on our side, not something you did. Trying again often works; if it does not,
              your data is untouched and still safe.
            </p>
            {error.digest ? (
              <p className="mt-3">
                Reference: <code className="font-mono text-xs">{error.digest}</code>
              </p>
            ) : null}
          </>
        }
        action={
          <>
            <Button onClick={reset}>Try again</Button>
            <ButtonLink href="/app" variant="secondary">
              Back to dashboard
            </ButtonLink>
          </>
        }
      />
    </div>
  );
}
