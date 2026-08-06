/**
 * Explicit Auth.js cookie posture.
 *
 * These values match what Auth.js would derive on its own — the point is that
 * they are now *stated and tested* rather than inherited. A silent upstream
 * default change, or a deployment served over http, would otherwise weaken
 * session cookies without anything failing.
 *
 * Pure and dependency-free so both modes can be asserted in unit tests without
 * standing up an HTTPS server.
 */

export type CookieAttributes = {
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
  secure: boolean;
};

export type CookieDefinition = { name: string; options: CookieAttributes };

export type AuthCookieOptions = {
  sessionToken: CookieDefinition;
  callbackUrl: CookieDefinition;
  csrfToken: CookieDefinition;
};

/**
 * The `__Secure-` prefix is a browser-enforced guarantee: a cookie carrying it
 * is rejected unless it also sets `Secure`. Applying it in development, where
 * the dev server is plain http, would silently break every session.
 */
function prefixed(name: string, isProduction: boolean): string {
  return isProduction ? `__Secure-${name}` : name;
}

export function buildCookieOptions(isProduction: boolean): AuthCookieOptions {
  const base: CookieAttributes = {
    // Not readable from JavaScript, so an XSS foothold cannot exfiltrate the
    // session token.
    httpOnly: true,
    // Lax, not Strict: the OAuth callback and sign-in redirect are top-level
    // cross-site GET navigations, which Strict would strip the cookie from,
    // breaking Google sign-in. Lax still withholds the cookie from cross-site
    // POSTs, which is what protects the mutation routes from CSRF.
    sameSite: "lax",
    path: "/",
    secure: isProduction,
  };

  return {
    sessionToken: {
      name: prefixed("authjs.session-token", isProduction),
      options: base,
    },
    callbackUrl: {
      name: prefixed("authjs.callback-url", isProduction),
      options: base,
    },
    csrfToken: {
      // Auth.js names this `__Host-` in secure mode: a stricter prefix that
      // additionally forbids a Domain attribute, so the CSRF token cannot be
      // set by a sibling subdomain.
      name: isProduction ? "__Host-authjs.csrf-token" : "authjs.csrf-token",
      options: base,
    },
  };
}

/**
 * Auth.js derives `secure` from the configured URL. Stating it explicitly means
 * a production deployment that is somehow reached over http fails to set a
 * cookie rather than setting an insecure one.
 *
 * Deliberately **not** named `useSecureCookies`: a `use` prefix makes React's
 * rules-of-hooks lint treat a plain function as a Hook.
 */
export function shouldUseSecureCookies(isProduction: boolean): boolean {
  return isProduction;
}
