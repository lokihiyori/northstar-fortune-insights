import "server-only";

/**
 * Google is optional in local development. The UI must not offer a provider
 * that is not configured, or the button leads to a provider error page.
 */
export function isGoogleConfigured(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}
