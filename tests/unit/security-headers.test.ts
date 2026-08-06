import { describe, expect, it } from "vitest";
import { CSP_ENFORCEMENT_BLOCKERS, buildSecurityHeaders } from "@/lib/security/headers";

function headerMap(isProduction: boolean): Record<string, string> {
  return Object.fromEntries(buildSecurityHeaders(isProduction).map((h) => [h.key, h.value]));
}

const dev = headerMap(false);
const prod = headerMap(true);

describe("baseline headers in both modes", () => {
  it("sets nosniff, DENY, and a referrer policy", () => {
    for (const headers of [dev, prod]) {
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    }
  });

  it("denies the device features this product never uses", () => {
    for (const headers of [dev, prod]) {
      const policy = headers["Permissions-Policy"] ?? "";
      for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
        expect(policy).toContain(`${feature}=()`);
      }
    }
  });
});

describe("HSTS is production-only", () => {
  it("is absent in development, so localhost is never pinned to https", () => {
    expect(dev["Strict-Transport-Security"]).toBeUndefined();
  });

  it("is present in production with a long max-age", () => {
    const hsts = prod["Strict-Transport-Security"];
    expect(hsts).toBeDefined();
    expect(hsts).toContain("includeSubDomains");

    const maxAge = Number(/max-age=(\d+)/.exec(hsts!)?.[1] ?? 0);
    expect(maxAge).toBeGreaterThanOrEqual(31_536_000);
  });
});

describe("CSP is Report-Only, not enforcing", () => {
  it("uses the Report-Only header name in both modes", () => {
    for (const headers of [dev, prod]) {
      expect(headers["Content-Security-Policy-Report-Only"]).toBeDefined();
      // Enforcement would be this key. It must stay absent until the blockers
      // are resolved — its presence here would be a false claim of enforcement.
      expect(headers["Content-Security-Policy"]).toBeUndefined();
    }
  });

  it("documents what blocks enforcement", () => {
    expect(CSP_ENFORCEMENT_BLOCKERS.length).toBeGreaterThan(0);
    expect(CSP_ENFORCEMENT_BLOCKERS.join(" ")).toMatch(/nonce/i);
  });
});

describe("CSP directives", () => {
  it("forbids framing entirely", () => {
    for (const headers of [dev, prod]) {
      const csp = headers["Content-Security-Policy-Report-Only"] ?? "";
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
    }
  });

  it("restricts base-uri and form-action to our own origin", () => {
    const csp = prod["Content-Security-Policy-Report-Only"] ?? "";
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("never uses a bare wildcard for any directive", () => {
    // A `*` would make the policy meaningless while still looking present.
    for (const headers of [dev, prod]) {
      const csp = headers["Content-Security-Policy-Report-Only"] ?? "";
      expect(csp).not.toMatch(/(^|[\s;])\*(\s|;|$)/);
      expect(csp).not.toContain("https: http:");
    }
  });

  it("allows 'unsafe-eval' only in development, where Turbopack HMR needs it", () => {
    expect(dev["Content-Security-Policy-Report-Only"]).toContain("'unsafe-eval'");
    expect(prod["Content-Security-Policy-Report-Only"]).not.toContain("'unsafe-eval'");
  });

  it("allows the dev websocket only in development", () => {
    expect(dev["Content-Security-Policy-Report-Only"]).toContain("ws:");
    expect(prod["Content-Security-Policy-Report-Only"]).not.toContain("ws:");
  });

  it("upgrades insecure requests only in production", () => {
    expect(prod["Content-Security-Policy-Report-Only"]).toContain("upgrade-insecure-requests");
    expect(dev["Content-Security-Policy-Report-Only"]).not.toContain("upgrade-insecure-requests");
  });

  it("self-hosts fonts rather than allowing a third-party origin", () => {
    const csp = prod["Content-Security-Policy-Report-Only"] ?? "";
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).not.toContain("fonts.gstatic.com");
  });
});
