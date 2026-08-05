import NextAuth from "next-auth";
import { authConfig } from "@/features/auth/config";

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts`; the contract is unchanged.
 *
 * This is a fast redirect, not the security boundary. It runs on Edge with the
 * adapter-free config, so it can only check that a session token is present and
 * valid — it cannot read roles from the database or confirm the user still
 * exists. Every protected page and API route independently calls a guard from
 * `src/features/auth/guards.ts`, and that is what actually enforces access.
 */
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // /app and /admin. Matching auth endpoints or static assets would break
  // sign-in. Note this only redirects *unauthenticated* requests — the edge
  // config cannot read roles, so admin authorization is enforced entirely by
  // `requireAdmin` in the layout, pages, and API handlers.
  matcher: ["/app/:path*", "/admin/:path*"],
};
