"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { headers } from "next/headers";
import { reserve, settleCredentialAttempt } from "@/lib/rate-limit/enforce";
import { runWithActionContext } from "@/lib/observability/context";
import { logger } from "@/lib/observability/logger";
import { demoAccountEmail, demoAccountPassword, demoModeEnabled } from "./config";

export type DemoSignInState = { status: "idle" | "error"; message?: string };

/**
 * Signs the visitor into the shared demo account.
 *
 * The credentials never reach the browser: the form posts an intent, and this
 * action supplies the address and password from server configuration. There is
 * no endpoint that returns them and none that creates arbitrary accounts.
 *
 * Every check that guards ordinary sign-in still applies — the same credentials
 * provider, the same rate-limit policies, the same callback-URL sanitization.
 * Direct invocation of this action re-checks demo mode, so a stale page cannot
 * use it after the flag is turned off.
 */
export async function demoSignInAction(
  _previous: DemoSignInState,
  formData: FormData,
): Promise<DemoSignInState> {
  return runWithActionContext("demo.signInAction", () => performDemoSignIn(formData));
}

const UNAVAILABLE = "The demo is not available right now.";

async function performDemoSignIn(formData: FormData): Promise<DemoSignInState> {
  // Re-checked on every invocation, not just when the button was rendered.
  if (!demoModeEnabled()) {
    logger.warn("demo.sign_in_refused", { reason: "disabled" });
    return { status: "error", message: UNAVAILABLE };
  }

  const email = demoAccountEmail();
  const password = demoAccountPassword();

  if (email === null || password === null) {
    // Misconfiguration fails closed and says nothing about which half is wrong.
    logger.warn("demo.sign_in_refused", { reason: "not_configured" });
    return { status: "error", message: UNAVAILABLE };
  }

  const raw = formData.get("demoCallbackUrl");
  const callbackUrl = typeof raw === "string" ? raw : "";
  const redirectTo =
    callbackUrl.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/app";

  // Same reservation flow as ordinary sign-in: the shared account must not be
  // exempt from credential limiting just because the password is ours.
  const attempt = await reserve("signIn", { headers: await headers(), identifier: email });
  if (attempt.kind !== "allow") {
    logger.warn("demo.sign_in_refused", {
      reason: attempt.kind === "limit" ? "rate_limited" : "backend_unavailable",
    });
    return { status: "error", message: UNAVAILABLE };
  }

  try {
    await signIn("credentials", { email, password, redirectTo });
  } catch (error) {
    const definitivelyWrong = error instanceof AuthError && error.type === "CredentialsSignin";

    await settleCredentialAttempt(
      attempt.reservation,
      definitivelyWrong ? "invalid-credentials" : "authenticated",
    );

    if (definitivelyWrong) {
      // The demo row is missing or its password no longer matches
      // configuration. `pnpm demo:reset` is the fix; the visitor gets nothing
      // that hints at either.
      logger.warn("demo.sign_in_refused", { reason: "account_unavailable" });
      return { status: "error", message: UNAVAILABLE };
    }

    // A successful sign-in also leaves through here — `signIn` throws a
    // redirect rather than returning.
    throw error;
  }

  return { status: "idle" };
}
