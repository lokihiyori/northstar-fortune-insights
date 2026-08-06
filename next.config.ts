import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/security/headers";

/**
 * Security headers are applied here rather than in `proxy.ts` on purpose.
 *
 * `headers()` covers every route including statically rendered ones, and costs
 * nothing at request time. Setting them in the proxy would only cover matched
 * paths and, if nonces were added, would force dynamic rendering across the
 * whole marketing site.
 *
 * `NODE_ENV` is read when the config loads: `production` for both `next build`
 * and `next start`, `development` for `next dev`. That is what keeps HSTS off
 * local http development.
 */
const isProduction = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [
      {
        // Every route, including API handlers and static assets.
        source: "/:path*",
        headers: buildSecurityHeaders(isProduction),
      },
    ];
  },
};

export default nextConfig;
