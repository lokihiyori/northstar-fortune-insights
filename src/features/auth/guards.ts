import "server-only";

import { redirect } from "next/navigation";
import type { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiError, type ApiError } from "@/lib/api/response";
import type { UserRole } from "@/generated/prisma/enums";

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  name?: string | null;
  image?: string | null;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
  };
}

/**
 * For Server Components and layouts. Redirects rather than throwing, so an
 * unauthenticated visitor lands on sign-in with a return path instead of an
 * error page.
 *
 * This is the real access control, not the middleware — middleware only makes
 * the redirect happen sooner (see ADR 0006).
 */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (user) return user;

  const target = returnTo ? `/sign-in?callbackUrl=${encodeURIComponent(returnTo)}` : "/sign-in";
  redirect(target);
}

export async function requireAdmin(returnTo?: string): Promise<SessionUser> {
  const user = await requireUser(returnTo);
  // Not found rather than forbidden: an admin area should not confirm it exists.
  if (user.role !== "ADMIN") redirect("/app");
  return user;
}

/**
 * For Route Handlers. Returns a discriminated result instead of redirecting,
 * because an API must answer with a status code, not an HTML redirect.
 */
export type ApiAuthResult =
  { ok: true; user: SessionUser } | { ok: false; response: NextResponse<ApiError> };

export async function requireApiUser(): Promise<ApiAuthResult> {
  const user = await getSessionUser();
  if (!user) {
    return {
      ok: false,
      response: apiError("UNAUTHENTICATED", "Sign in to continue."),
    };
  }
  return { ok: true, user };
}

export async function requireApiAdmin(): Promise<ApiAuthResult> {
  const result = await requireApiUser();
  if (!result.ok) return result;

  if (result.user.role !== "ADMIN") {
    return {
      ok: false,
      response: apiError("FORBIDDEN", "You do not have access to this resource."),
    };
  }
  return result;
}
