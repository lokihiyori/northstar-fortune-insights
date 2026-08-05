import { parseClientEnv } from "./schema";

/**
 * Next.js inlines `NEXT_PUBLIC_*` at build time, so each value must be read as a
 * full static property access rather than through a dynamic key.
 */
export const clientEnv = parseClientEnv({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
});
