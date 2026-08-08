import { describe, expect, it } from "vitest";
import {
  errorName,
  isForbiddenFieldName,
  maskEmail,
  sanitizeFields,
} from "@/lib/observability/redact";

/**
 * The redaction policy, written as the guarantee rather than the mechanism:
 * these are the values that must never reach a log file, expressed as the kinds
 * of field a developer would plausibly pass by accident.
 */

const SECRETS = {
  password: "e2e-test-passphrase",
  AUTH_SECRET: "a-real-looking-auth-secret-value-0000",
  DATABASE_URL: "postgresql://northstar:northstar@127.0.0.1:55432/northstar",
  REDIS_URL: "redis://127.0.0.1:56379",
  STRIPE_SECRET_KEY: "sk_test_51NotARealKeyAtAll",
  OPENAI_API_KEY: "sk-proj-NotARealKeyEither",
  authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
  cookie: "authjs.session-token=abc123; Path=/",
  sessionToken: "eyJhbGciOiJIUzI1NiJ9.payload.signature",
};

const PRIVATE_CONTENT = {
  email: "someone.private@example.com",
  question: "Should I leave my job to retrain as a paramedic in Nova Scotia?",
  reportSummary: "Three paths were identified, the strongest being...",
  sourceContent: "Bridge training programs help internationally trained professionals...",
  requestBody: '{"topic":"CAREER","question":"..."}',
  queryString: "?email=someone@example.com&token=abc",
};

describe("isForbiddenFieldName", () => {
  it("refuses every credential-shaped name", () => {
    for (const key of [
      "password",
      "userPassword",
      "passphrase",
      "AUTH_SECRET",
      "secret",
      "clientSecret",
      "token",
      "sessionToken",
      "tokenCount",
      "cookie",
      "cookieHeader",
      "authorization",
      "credential",
      "apiKey",
      "api_key",
      "apiKeyPrefix",
      "dsn",
      "signature",
      "passwordHash",
      "key",
    ]) {
      expect(isForbiddenFieldName(key), key).toBe(true);
    }
  });

  it("refuses names that carry user or source content", () => {
    for (const key of [
      "question",
      "questionText",
      "answer",
      "comment",
      "reportSummary",
      "content",
      "sourceContent",
      "body",
      "requestBody",
      "email",
      "userEmail",
      "email_address",
      "prompt",
      "passage",
      "queryString",
      "headers",
      "payload",
      "title",
      "url",
      "canonicalUrl",
      "connectionString",
    ]) {
      expect(isForbiddenFieldName(key), key).toBe(true);
    }
  });

  it("allows identifiers and measurements derived from those names", () => {
    // `reportId` is an opaque cuid and `chunkCount` an integer. Refusing them
    // would cost real diagnostic signal for no privacy gain.
    for (const key of [
      "reportId",
      "sourceId",
      "generationId",
      "chunkCount",
      "questionLength",
      "criteriaCount",
      "bodyBytes",
      "contentLength",
      "promptVersion",
      "reportStatus",
    ]) {
      expect(isForbiddenFieldName(key), key).toBe(false);
    }
  });

  it("still refuses a credential even with a measurement suffix", () => {
    // There is no safe projection of a secret.
    expect(isForbiddenFieldName("tokenLength")).toBe(true);
    expect(isForbiddenFieldName("secretId")).toBe(true);
  });

  it("allows the operational fields the log schema is built from", () => {
    for (const key of [
      "requestId",
      "route",
      "method",
      "status",
      "durationMs",
      "actorId",
      "errorCategory",
      "errorType",
      "policyId",
      "retryAfterSeconds",
      "topic",
      "database",
      "cache",
      "nodeEnv",
      "providers",
    ]) {
      expect(isForbiddenFieldName(key), key).toBe(false);
    }
  });
});

describe("sanitizeFields", () => {
  it("drops every secret, whatever the field is called", () => {
    const output = sanitizeFields(SECRETS);
    const serialized = JSON.stringify(output);

    expect(Object.keys(output)).toHaveLength(0);
    for (const value of Object.values(SECRETS)) {
      expect(serialized).not.toContain(value);
    }
  });

  it("drops every piece of private content", () => {
    const output = sanitizeFields(PRIVATE_CONTENT);
    const serialized = JSON.stringify(output);

    expect(Object.keys(output)).toHaveLength(0);
    expect(serialized).not.toContain("paramedic");
    expect(serialized).not.toContain("someone.private@example.com");
    expect(serialized).not.toContain("Bridge training");
  });

  it("keeps allowed primitives", () => {
    expect(
      sanitizeFields({ status: 200, durationMs: 12, route: "/api/v1/me", cached: true }),
    ).toEqual({ status: 200, durationMs: 12, route: "/api/v1/me", cached: true });
  });

  it("never walks an object, so nested private data cannot slip through", () => {
    // An object is the classic accident: `logger.info(event, { user })` would
    // otherwise serialize an entire record.
    const output = sanitizeFields({
      user: { id: "u1", email: "someone@example.com" },
      tags: ["a", "b"],
      nested: { deep: { question: "private" } },
    });

    expect(output).toEqual({});
    expect(JSON.stringify(output)).not.toContain("someone@example.com");
  });

  it("drops undefined, symbols, functions, and non-finite numbers", () => {
    expect(
      sanitizeFields({
        missing: undefined,
        sym: Symbol("s"),
        fn: () => "x",
        nan: Number.NaN,
        infinite: Number.POSITIVE_INFINITY,
        kept: 1,
      }),
    ).toEqual({ kept: 1 });
  });

  it("keeps an explicit null, which is meaningful", () => {
    expect(sanitizeFields({ actorId: null })).toEqual({ actorId: null });
  });

  it("strips control characters so a value cannot forge a log entry", () => {
    const output = sanitizeFields({ route: "/api/v1/me\nlevel=error event=forged" });

    expect(output["route"]).not.toContain("\n");
    expect(output["route"]).toBe("/api/v1/me level=error event=forged");
  });

  it("truncates an oversized value rather than filling a disk", () => {
    const output = sanitizeFields({ route: "x".repeat(5_000) });
    const value = output["route"];

    expect(typeof value).toBe("string");
    expect((value as string).length).toBeLessThan(300);
    expect(value).toContain("[truncated]");
  });
});

describe("errorName", () => {
  it("returns the name and never the message", () => {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:56379");
    error.name = "RedisConnectionError";

    const name = errorName(error);
    expect(name).toBe("RedisConnectionError");
    expect(name).not.toContain("127.0.0.1");
    expect(name).not.toContain("ECONNREFUSED");
  });

  it("handles a thrown non-error without serializing it", () => {
    expect(errorName({ secret: "value" })).toBe("object");
    expect(errorName("a thrown string with a password")).toBe("string");
    expect(errorName(null)).toBe("object");
    expect(errorName(undefined)).toBe("undefined");
  });
});

describe("maskEmail", () => {
  it("keeps only the first letter and the top-level domain", () => {
    expect(maskEmail("someone.private@example.com")).toBe("s***@***.com");
    expect(maskEmail("a@b.co.uk")).toBe("a***@***.uk");
  });

  it("does not leak the local part or the domain", () => {
    const masked = maskEmail("firstname.lastname@sensitive-employer.test");
    expect(masked).not.toContain("firstname");
    expect(masked).not.toContain("lastname");
    expect(masked).not.toContain("sensitive-employer");
  });

  it("refuses to guess at a malformed address", () => {
    expect(maskEmail("not-an-email")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
  });
});
