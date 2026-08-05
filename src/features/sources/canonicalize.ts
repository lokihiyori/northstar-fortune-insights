/**
 * Canonical source URLs.
 *
 * The `canonicalUrl` column is unique, so this is what actually prevents the
 * same document being ingested twice under cosmetic variations —
 * `http` vs `https`, a trailing slash, a tracking parameter, differing case in
 * the host, or a `#section` fragment. Two admins adding the same page from
 * different places must collide rather than create two competing records.
 *
 * Deliberately conservative: the path case is preserved (many servers are
 * case-sensitive) and only known tracking parameters are dropped, because
 * removing a meaningful query parameter would point at a different document.
 */

/** Parameters that never identify a document, only how someone arrived at it. */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref",
  "referrer",
  "source",
]);

export type CanonicalizeResult = { ok: true; url: string } | { ok: false; reason: string };

export function canonicalizeUrl(input: string): CanonicalizeResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "Enter a source URL." };

  // A bare domain is a common paste; assume https rather than rejecting it.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: "That does not look like a valid URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http and https sources are supported." };
  }

  if (!url.hostname.includes(".")) {
    return { ok: false, reason: "That URL is missing a valid domain." };
  }

  // Upgrade to https: serving the same document over both is near-universal,
  // and treating them as two sources would duplicate the corpus.
  url.protocol = "https:";

  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";
  url.username = "";
  url.password = "";

  // Default ports carry no meaning once the scheme is normalized.
  if (url.port === "443" || url.port === "80") url.port = "";

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  // Stable ordering so ?a=1&b=2 and ?b=2&a=1 canonicalize identically.
  url.searchParams.sort();

  // A trailing slash on a path is cosmetic; on the root it is canonical.
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return { ok: true, url: url.toString() };
}

/** True when two URLs refer to the same document after canonicalization. */
export function isSameSource(a: string, b: string): boolean {
  const left = canonicalizeUrl(a);
  const right = canonicalizeUrl(b);
  return left.ok && right.ok && left.url === right.url;
}
