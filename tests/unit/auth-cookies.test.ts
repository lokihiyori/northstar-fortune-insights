import { describe, expect, it } from "vitest";
import { buildCookieOptions, shouldUseSecureCookies } from "@/features/auth/cookies";

const dev = buildCookieOptions(false);
const prod = buildCookieOptions(true);

const ALL_DEV = [dev.sessionToken, dev.callbackUrl, dev.csrfToken];
const ALL_PROD = [prod.sessionToken, prod.callbackUrl, prod.csrfToken];

describe("attributes that hold in every environment", () => {
  it("keeps every auth cookie HttpOnly", () => {
    for (const cookie of [...ALL_DEV, ...ALL_PROD]) {
      expect(cookie.options.httpOnly, cookie.name).toBe(true);
    }
  });

  it("uses SameSite=Lax", () => {
    // Lax, not Strict: the OAuth callback is a top-level cross-site navigation
    // that Strict would strip the cookie from, breaking Google sign-in. Lax
    // still withholds cookies from cross-site POSTs, which is the CSRF defence.
    for (const cookie of [...ALL_DEV, ...ALL_PROD]) {
      expect(cookie.options.sameSite, cookie.name).toBe("lax");
    }
  });

  it("scopes cookies to the whole site", () => {
    for (const cookie of [...ALL_DEV, ...ALL_PROD]) {
      expect(cookie.options.path, cookie.name).toBe("/");
    }
  });
});

describe("development posture", () => {
  it("does not set Secure, so cookies work over local http", () => {
    for (const cookie of ALL_DEV) {
      expect(cookie.options.secure, cookie.name).toBe(false);
    }
    expect(shouldUseSecureCookies(false)).toBe(false);
  });

  it("uses unprefixed names, because __Secure- requires Secure", () => {
    // A __Secure- cookie without the Secure attribute is rejected outright by
    // the browser, which would silently break every local session.
    for (const cookie of ALL_DEV) {
      expect(cookie.name).not.toMatch(/^__(Secure|Host)-/);
    }
  });
});

describe("production posture", () => {
  it("sets Secure on every cookie", () => {
    for (const cookie of ALL_PROD) {
      expect(cookie.options.secure, cookie.name).toBe(true);
    }
    expect(shouldUseSecureCookies(true)).toBe(true);
  });

  it("applies the __Secure- prefix to the session and callback cookies", () => {
    expect(prod.sessionToken.name).toBe("__Secure-authjs.session-token");
    expect(prod.callbackUrl.name).toBe("__Secure-authjs.callback-url");
  });

  it("applies the stricter __Host- prefix to the CSRF cookie", () => {
    // __Host- additionally forbids a Domain attribute, so a sibling subdomain
    // cannot set the CSRF token.
    expect(prod.csrfToken.name).toBe("__Host-authjs.csrf-token");
  });

  it("pairs every prefixed name with the Secure attribute it requires", () => {
    for (const cookie of ALL_PROD) {
      if (cookie.name.startsWith("__Secure-") || cookie.name.startsWith("__Host-")) {
        expect(cookie.options.secure, cookie.name).toBe(true);
      }
      if (cookie.name.startsWith("__Host-")) {
        expect(cookie.options.path, cookie.name).toBe("/");
      }
    }
  });
});

describe("no secrets in the configuration", () => {
  it("contains only names and attributes, never token values", () => {
    const serialized = JSON.stringify({ dev, prod });
    expect(serialized).not.toMatch(/eyJ|secret|token-value/i);
    // Names mentioning "csrf-token" are fine; actual values must be absent.
    expect(serialized).not.toContain("Bearer");
  });
});
