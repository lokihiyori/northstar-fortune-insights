"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signInAction, type AuthFormState } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/ui/field";

const INITIAL: AuthFormState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function SignInForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, formAction] = useActionState(signInAction, INITIAL);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      {state.message ? <FormMessage>{state.message}</FormMessage> : null}

      <Field
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        defaultValue={state.values?.email ?? ""}
        errors={state.fieldErrors?.["email"]}
      />

      <Field
        id="password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
        errors={state.fieldErrors?.["password"]}
      />

      <SubmitButton />
    </form>
  );
}
