"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { demoSignInAction, type DemoSignInState } from "@/features/demo/actions";

const INITIAL: DemoSignInState = { status: "idle" };

/**
 * Recruiter entry point. Renders only where the server decided to render it —
 * the component takes no flag from the client and carries no credentials; the
 * action supplies both from server configuration.
 */
export function DemoSignInButton({ callbackUrl }: { callbackUrl: string }) {
  const [state, formAction, pending] = useActionState(demoSignInAction, INITIAL);

  return (
    <form action={formAction} className="space-y-3">
      {/*
       * Named `demoCallbackUrl`, not `callbackUrl`: the sign-in form on the
       * same page already has a field by that name, and two inputs sharing it
       * make every selector for it ambiguous.
       */}
      <input type="hidden" name="demoCallbackUrl" value={callbackUrl} />

      <Button type="submit" variant="secondary" className="w-full" disabled={pending}>
        {pending ? "Opening the demo…" : "Explore the demo"}
      </Button>

      <p className="text-text-secondary text-xs">
        Opens a shared workspace with fictional data. No sign-up, and nothing you enter is private.
      </p>

      {state.status === "error" && state.message ? (
        <p role="alert" className="text-danger text-sm">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
