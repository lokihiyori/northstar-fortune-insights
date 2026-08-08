import { expect, test } from "@playwright/test";
import { SEEDED_USER, TEST_PASSWORD, uniqueEmail } from "./helpers/db";

/**
 * Request correlation, liveness, and readiness through real HTTP.
 *
 * These assert what a caller and an operator actually see: the header on the
 * response, the id inside the error envelope, and the two health endpoints
 * answering the two different questions they exist for.
 */

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

test.describe("request correlation", () => {
  test("a successful request returns an X-Request-ID", async ({ request }) => {
    const response = await request.get("/api/v1/health");

    expect(response.status()).toBe(200);
    const requestId = response.headers()["x-request-id"];
    expect(requestId, "every API response must carry a correlation id").toBeDefined();
    expect(requestId).toMatch(SAFE_ID);
  });

  test("an authentication error carries the same id in header and body", async ({ request }) => {
    const response = await request.get("/api/v1/me");

    expect(response.status()).toBe(401);
    const header = response.headers()["x-request-id"];
    const body = (await response.json()) as { error: { code: string; requestId: string } };

    expect(body.error.code).toBe("UNAUTHENTICATED");
    // The whole point: a user quoting the id from the body lands an operator on
    // the log line for the same request.
    expect(body.error.requestId).toBe(header);
    expect(header).toMatch(SAFE_ID);
  });

  test("a validation error carries the same id in header and body", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(SEEDED_USER.email);
    await page.getByLabel("Password").fill(SEEDED_USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app/);

    const response = await page.request.post("/api/v1/guidance", {
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      data: { topic: "NOT_A_TOPIC", question: "too short" },
    });

    expect(response.status()).toBe(422);
    const body = (await response.json()) as { error: { code: string; requestId: string } };

    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.requestId).toBe(response.headers()["x-request-id"]);
  });

  test("a rate-limit error carries the same id in header and body", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByLabel("Email").fill(uniqueEmail("obs-rl"));
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/app\/onboarding/);

    const body = {
      topic: "EDUCATION",
      question: "Is a part-time diploma a realistic route while working full time?",
      criteria: [{ key: "SPEED", weight: 3 }],
      includeProfile: false,
    };

    const submit = () =>
      page.request.post("/api/v1/guidance", {
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        data: body,
      });

    // GUIDANCE_USER allows three; the fourth is refused.
    for (let attempt = 0; attempt < 3; attempt += 1) await submit();
    const refused = await submit();

    expect(refused.status()).toBe(429);
    const payload = (await refused.json()) as { error: { code: string; requestId: string } };

    expect(payload.error.code).toBe("RATE_LIMITED");
    expect(payload.error.requestId).toBe(refused.headers()["x-request-id"]);
    // The 8B contract is untouched by correlation.
    expect(Number(refused.headers()["retry-after"])).toBeGreaterThan(0);
  });

  test("honours a well-formed incoming id so an upstream trace survives", async ({ request }) => {
    const supplied = "e2e-trace-0000000001";

    const response = await request.get("/api/v1/me", {
      headers: { "x-request-id": supplied },
    });

    expect(response.headers()["x-request-id"]).toBe(supplied);
    const body = (await response.json()) as { error: { requestId: string } };
    expect(body.error.requestId).toBe(supplied);
  });

  test("replaces a malformed or oversized incoming id", async ({ request }) => {
    for (const hostile of [
      "not a valid id",
      "short",
      "x".repeat(500),
      "abc12345;DROP TABLE users",
    ]) {
      const response = await request.get("/api/v1/me", {
        headers: { "x-request-id": hostile },
      });

      const returned = response.headers()["x-request-id"];
      expect(returned, hostile).toMatch(SAFE_ID);
      expect(returned, hostile).not.toBe(hostile);
      // Nothing from the hostile value survives into the response.
      expect(returned).not.toContain("DROP TABLE");
      expect(returned).not.toContain(" ");
    }
  });

  test("gives two different requests two different ids", async ({ request }) => {
    const first = await request.get("/api/v1/health");
    const second = await request.get("/api/v1/health");

    expect(first.headers()["x-request-id"]).not.toBe(second.headers()["x-request-id"]);
  });
});

test.describe("liveness and readiness", () => {
  test("liveness answers 200 without touching a dependency", async ({ request }) => {
    const response = await request.get("/api/v1/health");

    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      data: { status: string; service: string; phase: number };
    };

    expect(body.data.status).toBe("ok");
    expect(body.data.service).toBe("northstar");

    // Minimal and non-sensitive: no dependency states, hosts, or versions.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("database");
    expect(serialized).not.toContain("redis");
    expect(serialized).not.toContain("127.0.0.1");
  });

  test("readiness reports both dependencies as ready", async ({ request }) => {
    const response = await request.get("/api/v1/ready");

    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      data: { status: string; checks: { database: string; cache: string } };
    };

    expect(body.data).toEqual({ status: "ready", checks: { database: "ok", cache: "ok" } });
  });

  test("readiness exposes nothing about the topology", async ({ request }) => {
    const response = await request.get("/api/v1/ready");
    const text = await response.text();

    // Reachable by anyone, so no host, port, user, database name, or driver
    // detail may appear — in either the ready or the not-ready shape.
    for (const leak of ["127.0.0.1", "55432", "56379", "northstar:", "postgresql://", "redis://"]) {
      expect(text, leak).not.toContain(leak);
    }
  });

  test("both endpoints carry a correlation id like every other route", async ({ request }) => {
    for (const path of ["/api/v1/health", "/api/v1/ready"]) {
      const response = await request.get(path);
      expect(response.headers()["x-request-id"], path).toMatch(SAFE_ID);
    }
  });
});
