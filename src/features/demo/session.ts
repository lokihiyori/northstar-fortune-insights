import "server-only";

import { prisma } from "@/lib/db/prisma";
import { getSessionUser, type SessionUser } from "@/features/auth/guards";
import type { NextResponse } from "next/server";
import { apiError, type ApiError } from "@/lib/api/response";
import { isDemoEmail } from "./config";

/**
 * Whether the *current request* belongs to the demo account.
 *
 * Two functions, deliberately, because they answer different questions:
 *
 *   - `isDemoSession` reads the session. Good enough for labelling — a banner
 *     that appears when it should not is a cosmetic bug.
 *   - `assertNotDemo` re-reads the row from the database. Used wherever demo
 *     status *denies* something, following the same rule the project already
 *     applies to roles: the token is a hint, the database is the authority
 *     (CLAUDE.md, ADR 0006).
 */
export function isDemoSession(user: Pick<SessionUser, "email"> | null): boolean {
  return user !== null && isDemoEmail(user.email);
}

/** Session-derived demo flag for the current request, for UI labelling. */
export async function currentSessionIsDemo(): Promise<boolean> {
  return isDemoSession(await getSessionUser());
}

export type DemoDenial = { ok: false; response: NextResponse<ApiError> };
export type DemoAllowed = { ok: true };

/**
 * Refuses an action for the demo account, checking the database rather than
 * the session.
 *
 * A stale or crafted token cannot talk its way past this: the email is read
 * from the row the id points at.
 */
export async function assertNotDemo(
  userId: string,
  action: string,
): Promise<DemoAllowed | DemoDenial> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });

  if (row !== null && isDemoEmail(row.email)) {
    return {
      ok: false,
      response: apiError("FORBIDDEN", `${action} is not available in the demo workspace.`, {
        status: 403,
      }),
    };
  }

  return { ok: true };
}

/** Database-backed demo check for server code that needs a plain boolean. */
export async function userIsDemo(userId: string): Promise<boolean> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return row !== null && isDemoEmail(row.email);
}
