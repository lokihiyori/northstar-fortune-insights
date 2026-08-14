import type { NextAuthConfig } from "next-auth";
import { buildCookieOptions, shouldUseSecureCookies } from "./cookies";

/**
 * Edge-safe half of the Auth.js configuration.
 *
 * `middleware.ts` runs in the Edge runtime, where the Prisma adapter cannot go.
 * Splitting the config lets middleware verify the session token without pulling
 * in the database client. The providers and adapter are added in `src/auth.ts`,
 * which only ever runs in Node.
 */
const isProduction = process.env.NODE_ENV === "production";

export const authConfig = {
  providers: [],
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  // Stated rather than inherited (Phase 8A). See features/auth/cookies.ts for
  // why SameSite is Lax and why the __Secure- prefix is production-only.
  useSecureCookies: shouldUseSecureCookies(isProduction),
  cookies: buildCookieOptions(isProduction),
  session: {
    // Forced by the credentials provider: Auth.js cannot issue a database
    // session for it. See docs/adr/0006-jwt-sessions-and-layered-authorization.md.
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 30,
  },
  callbacks: {
    // Consulted by middleware. Returning false triggers a redirect to signIn.
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
  },
} satisfies NextAuthConfig;
