"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { hashPassword } from "@/features/auth/password";
import { signInSchema, signUpSchema } from "@/features/auth/validation";
import { prisma } from "@/lib/db/prisma";
import { fieldErrorsFrom } from "@/lib/api/response";
import { enforceAction, recordFailedAttempt } from "@/lib/rate-limit/enforce";

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

  // Checked without consuming: credential policies count failures only, so a
  // person signing in legitimately several times can never lock themselves out.
  const limited = await enforceAction("signIn", context);
  if (limited) {
    // Same shape as a wrong password, and a message that names no account, so
    // this cannot be used to tell a real address from an unregistered one.
    return { status: "error", message: limited.message, values };
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
    if (error instanceof AuthError) {
      // Only now is the attempt charged. A success throws a redirect instead of
      // reaching this branch, so it never counts against the allowance.
      await recordFailedAttempt("signIn", context);

      return {
        status: "error",
        // Deliberately does not say which of the two was wrong.
        message: "That email and password combination is not correct.",
        values,
      };
    }
    throw error;
  }

  return { status: "idle" };
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
