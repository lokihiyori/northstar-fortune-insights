"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { registerAction, type AuthFormState } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/ui/field";

const INITIAL: AuthFormState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Creating your account…" : "Create account"}
    </Button>
  );
}

export function SignUpForm() {
  const [state, formAction] = useActionState(registerAction, INITIAL);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.message ? <FormMessage>{state.message}</FormMessage> : null}

      <Field
        id="name"
        name="name"
        type="text"
        label="Name"
        hint="Optional. Used only to address you in the app."
        autoComplete="name"
        defaultValue={state.values?.name ?? ""}
        errors={state.fieldErrors?.["name"]}
      />

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
        hint="At least 12 characters. A short phrase you will remember beats a short scramble you will not."
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.["password"]}
      />

      <SubmitButton />
    </form>
  );
}
