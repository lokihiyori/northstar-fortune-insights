import { expect, test } from "@playwright/test";
import { SEEDED_USER } from "./helpers/db";

/**
 * Security headers and cookie posture, asserted against real HTTP responses.
 *
 * The suite runs against the development server, so this proves the
 * development half of the contract: headers present on every route type, and
 * **HSTS absent** so localhost is never pinned to https. The production half is
 * covered by unit tests over the same pure builders, plus a manual production
 * build check recorded in the Phase 8A report.
 */
const ROUTES = [
  { path: "/", kind: "public page" },
  { path: "/pricing", kind: "static marketing page" },
  { path: "/sign-in", kind: "auth page" },
  { path: "/api/v1/health", kind: "API route" },
  { path: "/app", kind: "protected route (redirects)" },
];

test.describe("security headers", () => {
  for (const route of ROUTES) {
    test(`sets baseline headers on ${route.kind}: ${route.path}`, async ({ request }) => {
      const response = await request.get(route.path, { maxRedirects: 0 });
      const headers = response.headers();

      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["permissions-policy"]).toContain("camera=()");

      const csp = headers["content-security-policy-report-only"];
      expect(csp, "CSP must be present in Report-Only form").toBeDefined();
      expect(csp).toContain("frame-ancestors 'none'");

      // Report-Only means nothing is blocked yet; claiming enforcement would be
      // false until the documented blockers are resolved.
      expect(headers["content-security-policy"]).toBeUndefined();
    });
  }

  test("does not send HSTS in local development", async ({ request }) => {
    // Sending it over http://localhost would pin the developer's browser to
    // https for localhost and break every other local project on that port.
    for (const route of ROUTES) {
      const response = await request.get(route.path, { maxRedirects: 0 });
      expect(response.headers()["strict-transport-security"], route.path).toBeUndefined();
    }
  });

  test("does not advertise the framework", async ({ request }) => {
    const response = await request.get("/");
    expect(response.headers()["x-powered-by"]).toBeUndefined();
  });
});

test.describe("authentication cookie posture", () => {
  test("issues an HttpOnly, Lax, non-Secure session cookie over local http", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(SEEDED_USER.email);
    await page.getByLabel("Password").fill(SEEDED_USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app/);

    const cookies = await page.context().cookies();
    const session = cookies.find((cookie) => cookie.name.includes("authjs.session-token"));

    expect(session, "a session cookie must be issued").toBeDefined();
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
    expect(session?.path).toBe("/");

    // Development is plain http, so Secure must be off or the cookie would
    // never be stored. Production is asserted in tests/unit/auth-cookies.
    expect(session?.secure).toBe(false);
    // The __Secure- prefix requires Secure, so it must not appear here.
    expect(session?.name).not.toMatch(/^__(Secure|Host)-/);

    // The token value is never read, logged, or asserted on — only attributes.
  });

  test("clears the session on sign-out", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(SEEDED_USER.email);
    await page.getByLabel("Password").fill(SEEDED_USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app/);

    await page.getByRole("button", { name: "Sign out" }).click();
    // `commit` rather than the default `load`: this only needs to observe that
    // the sign-out redirect happened, not that every subresource on the
    // landing page — the heaviest in the app — finished downloading.
    await page.waitForURL("/", { waitUntil: "commit" });

    const remaining = (await page.context().cookies()).find(
      (cookie) => cookie.name.includes("authjs.session-token") && cookie.value.length > 0,
    );
    expect(remaining, "the session cookie must not survive sign-out").toBeUndefined();

    expect((await page.request.get("/api/v1/me")).status()).toBe(401);
  });
});
