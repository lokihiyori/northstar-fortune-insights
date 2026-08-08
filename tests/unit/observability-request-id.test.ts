import { describe, expect, it } from "vitest";
import {
  REQUEST_ID_HEADER,
  isSafeRequestId,
  newRequestId,
  resolveRequestId,
} from "@/lib/observability/request-id";

/**
 * A request id is echoed into a response header, an error envelope, and a log
 * line. It is therefore attacker-influenced data reaching three places where
 * injection matters, and these tests are written as that threat model rather
 * than as a format check.
 */

describe("isSafeRequestId", () => {
  it("accepts a UUID and other sane correlation ids", () => {
    expect(isSafeRequestId("018f4c2e-6c1a-7b2f-9d3e-1a2b3c4d5e6f")).toBe(true);
    expect(isSafeRequestId("abc12345")).toBe(true);
    expect(isSafeRequestId("trace_id-0000001")).toBe(true);
    expect(isSafeRequestId("a".repeat(64))).toBe(true);
  });

  it("rejects anything that could forge a second log line", () => {
    // A newline in a log field is how one entry becomes two.
    expect(isSafeRequestId("abc12345\nlevel=error")).toBe(false);
    expect(isSafeRequestId("abc12345\r\nGET /admin")).toBe(false);
    expect(isSafeRequestId("abc12345 ")).toBe(false);
    expect(isSafeRequestId("abc12345\u0000")).toBe(false);
    expect(isSafeRequestId("abc\tdefgh")).toBe(false);
  });

  it("rejects values that could break out of a header or a document", () => {
    expect(isSafeRequestId("<script>alert(1)</script>")).toBe(false);
    expect(isSafeRequestId('abc"; drop--')).toBe(false);
    expect(isSafeRequestId("abc/../../etc")).toBe(false);
    expect(isSafeRequestId("abc def123")).toBe(false);
  });

  it("rejects ids that are too short to correlate or too long to store", () => {
    expect(isSafeRequestId("")).toBe(false);
    expect(isSafeRequestId("abc")).toBe(false);
    expect(isSafeRequestId("a".repeat(65))).toBe(false);
    expect(isSafeRequestId("a".repeat(10_000))).toBe(false);
  });
});

describe("resolveRequestId", () => {
  it("keeps a well-formed incoming id so a caller's trace survives", () => {
    const incoming = "018f4c2e-6c1a-7b2f-9d3e-1a2b3c4d5e6f";
    expect(resolveRequestId(incoming)).toEqual({ requestId: incoming, source: "incoming" });
  });

  it("trims surrounding whitespace rather than rejecting over it", () => {
    const resolved = resolveRequestId("  abc12345  ");
    expect(resolved).toEqual({ requestId: "abc12345", source: "incoming" });
  });

  it("replaces a malformed id instead of failing the request", () => {
    // Refusing a request over a bad diagnostic header would be a poor trade:
    // the caller gets correlation either way.
    const resolved = resolveRequestId("not a valid id\n");

    expect(resolved.source).toBe("generated");
    expect(isSafeRequestId(resolved.requestId)).toBe(true);
    expect(resolved.requestId).not.toContain("not a valid id");
  });

  it("replaces an oversized id", () => {
    const resolved = resolveRequestId("x".repeat(5_000));

    expect(resolved.source).toBe("generated");
    expect(resolved.requestId.length).toBeLessThanOrEqual(64);
  });

  it("generates one when the header is absent", () => {
    for (const absent of [null, undefined, ""]) {
      const resolved = resolveRequestId(absent);
      expect(resolved.source).toBe("generated");
      expect(isSafeRequestId(resolved.requestId)).toBe(true);
    }
  });

  it("ignores a non-string value", () => {
    // Headers are strings, but a caller could pass something else.
    const resolved = resolveRequestId(undefined);
    expect(resolved.source).toBe("generated");
  });
});

describe("newRequestId", () => {
  it("produces unique, safe ids", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newRequestId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(isSafeRequestId(id)).toBe(true);
  });
});

describe("REQUEST_ID_HEADER", () => {
  it("is the conventional lowercase header name", () => {
    // Fetch normalizes header names to lowercase; matching that avoids a lookup
    // that silently never matches.
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
  });
});
