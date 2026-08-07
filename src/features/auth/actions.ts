"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { hashPassword } from "@/features/auth/password";
import { signInSchema, signUpSchema } from "@/features/auth/validation";
import { prisma } from "@/lib/db/prisma";
import { fieldErrorsFrom } from "@/lib/api/response";
import {
  actionLimitResult,
  enforceAction,
  reserve,
  settleCredentialAttempt,
} from "@/lib/rate-limit/enforce";

/**
 * Returned to the client so the form can re-render with accessible errors and
 * the user's input intact. The password is never echoed back.
 */
export type AuthFormState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  values?: { name?: string; email?: string };
};

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * One string for every credential rejection, whether the account exists or not.
 * Changing it in one branch only would turn the form into an enumeration oracle.
 */
const WRONG_CREDENTIALS = "That email and password combination is not correct.";

/**
 * A successful `signIn` reports itself by throwing Next's redirect signal, so
 * telling that apart from a real failure is what decides whether the attempt is
 * charged. Matched on the documented digest prefix rather than an internal
 * helper, which is not part of Next's public surface.
 */
function isRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function registerAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = {
    name: readString(formData, "name") || undefined,
    email: readString(formData, "email"),
    password: readString(formData, "password"),
  };
  const values = { name: raw.name ?? "", email: raw.email };

  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: fieldErrorsFrom(parsed.error),
      values,
    };
  }

  // Server-side, before any database work: account creation is the expensive
  // and abusable part, so a farm must be stopped ahead of the lookup, not after.
  const limited = await enforceAction("signUp", {
    headers: await headers(),
    identifier: parsed.data.email,
  });
  if (limited) {
    return { status: "error", message: limited.message, values };
  }

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });

  if (existing) {
    return {
      status: "error",
      fieldErrors: {
        email: ["An account with this email already exists. Try signing in instead."],
      },
      values,
    };
  }

  const passwordHash = await hashPassword(parsed.data.password);

  try {
    await prisma.user.create({
      data: {
        email: parsed.data.email,
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        passwordHash,
        // Created up front so onboarding always has a row to resume from.
        profile: { create: {} },
      },
    });
  } catch {
    // Most likely a race on the unique email between the check and the insert.
    return {
      status: "error",
      message: "We could not create that account. Please try again.",
      values,
    };
  }

  // Throws a redirect on success, which must propagate rather than be caught.
  await signIn("credentials", {
    email: parsed.data.email,
    password: parsed.data.password,
    redirectTo: "/app/onboarding",
  });

  return { status: "idle" };
}

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = {
    email: readString(formData, "email"),
    password: readString(formData, "password"),
  };
  const values = { email: raw.email };

  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: fieldErrorsFrom(parsed.error),
      values,
    };
  }

  const callbackUrl = readString(formData, "callbackUrl");

  const context = { headers: await headers(), identifier: parsed.data.email };

  /**
   * Capacity is reserved **before** the password is verified, not read and then
   * acted on. Reading first is not atomic: twenty simultaneous attempts all see
   * the same pre-attempt count and are all admitted, so one burst exceeds the
   * limit. Reserving means at most `limit` attempts can be inside verification
   * at once, whatever the concurrency.
   *
   * Verification is also the expensive half — scrypt is deliberately slow — so
   * the gate has to sit in front of it to be worth anything.
   */
  const attempt = await reserve("signIn", context);
  if (attempt.kind !== "allow") {
    // Same shape as a wrong password, and a message that names no account, so
    // this cannot be used to tell a real address from an unregistered one. A
    // Redis outage says "unavailable" here rather than "too many attempts".
    const refusal = actionLimitResult(attempt);
    return { status: "error", message: refusal?.message ?? WRONG_CREDENTIALS, values };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      // Same-origin paths only, so a crafted callbackUrl cannot bounce the user
      // to another site after a successful sign-in.
      redirectTo:
        callbackUrl.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/app",
    });
  } catch (error) {
    // A *successful* sign-in leaves through here too: `signIn` throws a redirect
    // rather than returning. Only a definitive credential rejection is charged.
    const definitivelyWrong = error instanceof AuthError && error.type === "CredentialsSignin";

    await settleCredentialAttempt(
      attempt.reservation,
      definitivelyWrong
        ? "invalid-credentials"
        : isRedirect(error)
          ? "authenticated"
          : "indeterminate",
    );

    if (error instanceof AuthError) {
      return {
        status: "error",
        // Deliberately does not say which of the two was wrong. A provider fault
        // reads the same way, so the response is never an oracle either.
        message: WRONG_CREDENTIALS,
        values,
      };
    }
    throw error;
  }

  // Not reached in practice — `signIn` always throws — but if the provider ever
  // returns instead, the reservation must not be left held.
  await settleCredentialAttempt(attempt.reservation, "authenticated");
  return { status: "idle" };
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
