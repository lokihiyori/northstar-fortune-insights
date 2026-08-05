import { expect, test, type Page } from "@playwright/test";
import {
  TEST_PASSWORD,
  getAuditActions,
  getSourceByUrl,
  isSourceRetrievable,
  promoteToAdmin,
  uniqueEmail,
  uniqueSourceUrl,
} from "./helpers/db";

/**
 * Phase 7 admin and source ingestion, against the real database.
 *
 * Nothing is mocked. Ingestion uses the deterministic embedder — the same
 * adapter development and CI select when no OPENAI_API_KEY is set — so the full
 * chunk → embed → publish → retrieve path runs offline.
 */
test.describe.configure({ mode: "serial" });

const CONTENT = `Bridge training programs help internationally trained professionals meet licensing requirements without repeating a full credential. Programs combine skills training, workplace experience, and exam preparation.

Eligibility is generally limited to applicants who already hold a credential and relevant experience from outside Canada, rather than people entering the field for the first time.

Funding varies by province and by program, and some programs charge tuition while others are fully subsidised for eligible applicants.`;

async function signUp(page: Page, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/app\/onboarding/);
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app/);
}

/** Creates an account, elevates it in the database, and re-signs in. */
async function createAdmin(page: Page): Promise<string> {
  const email = uniqueEmail("admin");
  await signUp(page, email);
  await promoteToAdmin(email);

  // The role lives in the JWT, so the session must be reissued for the new
  // role to take effect — a stale token must not grant admin access.
  await page.goto("/app");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("/");
  await signIn(page, email);

  return email;
}

test.describe("admin authorization", () => {
  test("a normal user cannot reach admin pages or the admin API", async ({ page }) => {
    const email = uniqueEmail("plain");
    await signUp(page, email);

    // Pages: the *server* redirects away rather than rendering. Asserted at the
    // HTTP level because following the redirect in the browser lands back on
    // the page we are already on, which aborts the navigation.
    for (const path of ["/admin", "/admin/sources", "/admin/sources/new"]) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect([302, 303, 307], `${path} must redirect`).toContain(response.status());
      expect(response.headers()["location"]).toContain("/app");
    }

    // And the admin UI never renders for them.
    await page.goto("/admin", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: "Operations" })).toHaveCount(0);

    // API: the established 403 envelope, not a redirect.
    const list = await page.request.get("/api/v1/admin/sources");
    expect(list.status()).toBe(403);
    const body = (await list.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.requestId).toBeTruthy();

    const create = await page.request.post("/api/v1/admin/sources", {
      data: {
        title: "Attempted",
        publisher: "Nobody",
        region: "Canada",
        topic: "CAREER",
        canonicalUrl: uniqueSourceUrl("forbidden"),
      },
    });
    expect(create.status()).toBe(403);

    // And nothing was written.
    expect(await getSourceByUrl(uniqueSourceUrl("forbidden"))).toBeNull();
  });

  test("an unauthenticated visitor is sent to sign-in, not shown the admin area", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/sign-in/);

    const response = await page.request.get("/api/v1/admin/sources");
    expect(response.status()).toBe(401);
  });
});

test("admin drives a source through its whole lifecycle", async ({ page }) => {
  await createAdmin(page);
  const url = uniqueSourceUrl("lifecycle");

  // --- create ---------------------------------------------------------------
  await page.goto("/admin/sources/new");
  await page.getByLabel("Title").fill("Bridge training programs");
  await page.getByLabel("Publisher").fill("Government of Ontario");
  await page.getByLabel("Canonical URL").fill(url);
  await page.getByLabel("Region").fill("Ontario");
  await page.getByLabel("Topic").selectOption("EDUCATION");
  await page
    .getByLabel("Why this source is relevant")
    .fill(
      "Province-funded programs that close the gap between an international credential and Ontario licensure.",
    );
  await page.getByLabel("Content", { exact: false }).fill(CONTENT);
  await page.getByRole("button", { name: "Create source" }).click();

  // Requires a cuid-shaped id: `[a-z0-9]+` would also match the /new page we
  // are submitting from, letting the wait pass before the source exists.
  await page.waitForURL(/\/admin\/sources\/[a-z0-9]{20,}/);

  const created = await getSourceByUrl(url);
  expect(created, "source must persist").not.toBeNull();
  expect(created?.status).toBe("DRAFT");
  // Content was chunked and embedded through the ingestion service.
  expect(created?.chunkCount).toBeGreaterThan(1);
  expect(created?.embeddedCount).toBe(created?.chunkCount);

  const sourceId = created!.id;

  // A draft is not retrievable, whatever its content.
  expect(await isSourceRetrievable(sourceId)).toBe(false);

  // --- publishing is refused before review ----------------------------------
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);

  const earlyPublish = await page.request.post(`/api/v1/admin/sources/${sourceId}/publish`);
  expect(earlyPublish.status()).toBe(409);
  expect((await getSourceByUrl(url))?.status).toBe("DRAFT");

  // --- edit metadata --------------------------------------------------------
  await page.getByLabel("Title").fill("Bridge training programs (Ontario)");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  expect((await getSourceByUrl(url))?.title).toBe("Bridge training programs (Ontario)");

  // --- review ---------------------------------------------------------------
  //
  // A successful transition re-renders in place rather than navigating, so the
  // wait is on the resulting UI. Waiting on the URL would match the page we are
  // already on and race the server action.
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();

  expect((await getSourceByUrl(url))?.status).toBe("REVIEWED");
  // Reviewed is still not retrievable.
  expect(await isSourceRetrievable(sourceId)).toBe(false);

  // --- publish --------------------------------------------------------------
  await page.getByRole("button", { name: "Publish" }).click();
  // Published sources can only be retired, so the Publish button disappears.
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);

  expect((await getSourceByUrl(url))?.status).toBe("PUBLISHED");

  // Now retrievable by the guidance engine's filters.
  expect(await isSourceRetrievable(sourceId)).toBe(true);

  // It also appears in the user-facing resource library.
  await page.goto("/app/resources");
  await expect(page.getByText("Bridge training programs (Ontario)")).toBeVisible();

  // --- retire ---------------------------------------------------------------
  await page.goto(`/admin/sources/${sourceId}`);
  await page.getByRole("button", { name: "Retire" }).click();
  // A retired source can only be re-reviewed, so that becomes the sole action.
  await expect(page.getByRole("button", { name: "Mark reviewed" })).toBeVisible();

  expect((await getSourceByUrl(url))?.status).toBe("RETIRED");

  // Excluded from new retrieval, while the row itself survives so historical
  // reports that cited it stay resolvable.
  expect(await isSourceRetrievable(sourceId)).toBe(false);
  expect(await getSourceByUrl(url)).not.toBeNull();

  await page.goto("/app/resources");
  await expect(page.getByText("Bridge training programs (Ontario)")).toHaveCount(0);

  // --- audit trail ----------------------------------------------------------
  const actions = await getAuditActions(sourceId);
  expect(actions).toContain("SOURCE_CREATED");
  expect(actions).toContain("SOURCE_INGESTED");
  expect(actions).toContain("SOURCE_UPDATED");
  expect(actions).toContain("SOURCE_REVIEWED");
  expect(actions).toContain("SOURCE_PUBLISHED");
  expect(actions).toContain("SOURCE_RETIRED");
  // Recorded in the order they happened.
  expect(actions.indexOf("SOURCE_PUBLISHED")).toBeLessThan(actions.indexOf("SOURCE_RETIRED"));
});

test("duplicate canonical URLs are refused, however they are written", async ({ page }) => {
  await createAdmin(page);
  const url = uniqueSourceUrl("dupe");

  const create = await page.request.post("/api/v1/admin/sources", {
    data: {
      title: "Original source",
      publisher: "Statistics Canada",
      region: "Canada",
      topic: "CAREER",
      canonicalUrl: url,
      summary: "A source used to prove duplicate detection works.",
    },
  });
  expect(create.status()).toBe(201);

  // The same document written with a tracking parameter and a fragment
  // canonicalizes to the same URL, so it must be refused.
  const duplicate = await page.request.post("/api/v1/admin/sources", {
    data: {
      title: "Same page, different link",
      publisher: "Statistics Canada",
      region: "Canada",
      topic: "CAREER",
      canonicalUrl: `${url}/?utm_source=newsletter#top`,
      summary: "This should collide with the original.",
    },
  });
  expect(duplicate.status()).toBe(409);

  await page.goto("/admin/sources");
  await expect(page.getByText("Same page, different link")).toHaveCount(0);
});
