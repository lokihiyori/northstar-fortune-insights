/**
 * Security response headers.
 *
 * Pure and dependency-free so `next.config.ts` can import it and unit tests can
 * assert both the development and production shapes without running a server.
 *
 * **CSP is Report-Only in Phase 8A and is not enforcing anything yet.** See
 * `CSP_ENFORCEMENT_BLOCKERS` below and docs/adr/0007 for what has to be
 * resolved before it can be switched to `Content-Security-Policy`.
 */

export type HeaderPair = { key: string; value: string };

/**
 * Directives are deliberately explicit rather than leaning on `default-src`, so
 * a future tightening changes one line rather than discovering what an
 * unstated directive was silently permitting.
 */
function buildCsp(isProduction: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],

    // 'unsafe-inline' is required today: Next injects inline bootstrap scripts
    // and next-themes writes an inline no-flash script before paint. Removing
    // it needs per-request nonces, which force dynamic rendering (see blockers).
    // 'unsafe-eval' is development-only — Turbopack's HMR runtime needs it.
    "script-src": isProduction
      ? ["'self'", "'unsafe-inline'"]
      : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],

    // Tailwind v4 emits a style element; styled-jsx and next/font also inline.
    "style-src": ["'self'", "'unsafe-inline'"],

    // next/font self-hosts Inter and Manrope at build time, so no font CDN is
    // needed. data: covers inlined subsets.
    "font-src": ["'self'", "data:"],

    // data: for inline SVG/base64; blob: for anything generated client-side.
    "img-src": ["'self'", "data:", "blob:"],

    // Same-origin API calls only. Stripe and OpenAI are called server-side, so
    // no third-party origin belongs here. Dev adds the HMR websocket.
    "connect-src": isProduction ? ["'self'"] : ["'self'", "ws:", "wss:"],

    // Nothing in this product embeds or is embedded.
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],

    "base-uri": ["'self'"],
    // Forms post only to our own origin; Stripe Checkout is a redirect, not a
    // cross-origin form post.
    "form-action": ["'self'"],
  };

  const serialized = Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");

  // Only meaningful over HTTPS, and it would break local http development.
  return isProduction ? `${serialized}; upgrade-insecure-requests` : serialized;
}

/**
 * Features this application never uses. Denying them limits what injected
 * script could reach even if CSP were bypassed.
 */
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=(self)",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

export function buildSecurityHeaders(isProduction: boolean): HeaderPair[] {
  const headers: HeaderPair[] = [
    // Report-Only: violations are reported by the browser console, nothing is
    // blocked. Renaming this key is the enforcement switch.
    { key: "Content-Security-Policy-Report-Only", value: buildCsp(isProduction) },

    { key: "X-Content-Type-Options", value: "nosniff" },
    // Redundant with frame-ancestors for modern browsers, kept for older ones.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: "X-DNS-Prefetch-Control", value: "on" },
  ];

  if (isProduction) {
    // Production only. Sending HSTS from a local http server would pin the
    // browser to https for localhost and break development for that developer.
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}

/**
 * What must be resolved before flipping Report-Only to enforcing.
 * Kept in code so it is reviewed alongside the policy it describes.
 */
export const CSP_ENFORCEMENT_BLOCKERS = [
  "script-src still needs 'unsafe-inline' for Next's bootstrap and the next-themes no-flash script. Removing it requires per-request nonces generated in proxy.ts, which forces dynamic rendering on all 10 currently-static marketing routes.",
  "style-src still needs 'unsafe-inline' for Tailwind v4 and next/font injected styles.",
  "No report-uri/report-to endpoint is configured, so violations are only visible in a browser console. Collecting them needs the Phase 8C observability boundary.",
  "The policy has not yet been exercised against a Stripe Checkout redirect, because Stripe remains unverified with no test-mode credentials.",
] as const;
