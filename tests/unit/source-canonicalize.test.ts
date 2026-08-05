import { describe, expect, it } from "vitest";
import { canonicalizeUrl, isSameSource } from "@/features/sources/canonicalize";

function url(input: string): string {
  const result = canonicalizeUrl(input);
  if (!result.ok) throw new Error(`expected ${input} to canonicalize: ${result.reason}`);
  return result.url;
}

describe("canonicalizeUrl", () => {
  it("forces https so the same page over both schemes is one source", () => {
    expect(url("http://example.gc.ca/page")).toBe("https://example.gc.ca/page");
  });

  it("strips a www prefix and lowercases the host", () => {
    expect(url("https://WWW.Example.GC.CA/page")).toBe("https://example.gc.ca/page");
  });

  it("removes fragments, which never identify a different document", () => {
    expect(url("https://example.gc.ca/page#section-3")).toBe("https://example.gc.ca/page");
  });

  it("removes tracking parameters but keeps meaningful ones", () => {
    expect(url("https://example.gc.ca/p?utm_source=x&id=42&fbclid=y")).toBe(
      "https://example.gc.ca/p?id=42",
    );
  });

  it("sorts query parameters so ordering cannot create a duplicate", () => {
    expect(url("https://example.gc.ca/p?b=2&a=1")).toBe(url("https://example.gc.ca/p?a=1&b=2"));
  });

  it("drops a trailing slash on a path but keeps the root slash", () => {
    expect(url("https://example.gc.ca/page/")).toBe("https://example.gc.ca/page");
    expect(url("https://example.gc.ca/")).toBe("https://example.gc.ca/");
  });

  it("removes default ports", () => {
    expect(url("https://example.gc.ca:443/page")).toBe("https://example.gc.ca/page");
    expect(url("http://example.gc.ca:80/page")).toBe("https://example.gc.ca/page");
  });

  it("keeps a non-default port, which does identify a different endpoint", () => {
    expect(url("https://example.gc.ca:8443/page")).toContain(":8443");
  });

  it("preserves path case, because many servers are case-sensitive", () => {
    expect(url("https://example.gc.ca/Some/Path")).toBe("https://example.gc.ca/Some/Path");
  });

  it("assumes https for a bare domain rather than rejecting a common paste", () => {
    expect(url("example.gc.ca/page")).toBe("https://example.gc.ca/page");
  });

  it("strips embedded credentials", () => {
    expect(url("https://user:pass@example.gc.ca/page")).toBe("https://example.gc.ca/page");
  });

  it("rejects input that is not a usable http source", () => {
    for (const bad of [
      "",
      "   ",
      "not a url",
      "ftp://example.gc.ca/f",
      "javascript:alert(1)",
      "https://localhost",
    ]) {
      expect(canonicalizeUrl(bad).ok).toBe(false);
    }
  });

  it("gives a reason on rejection so the admin can act on it", () => {
    const result = canonicalizeUrl("ftp://example.gc.ca/f");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/http/i);
  });
});

describe("isSameSource", () => {
  it("treats cosmetic variations of one page as the same source", () => {
    expect(
      isSameSource("http://www.Example.gc.ca/page/?utm_source=n#top", "https://example.gc.ca/page"),
    ).toBe(true);
  });

  it("keeps genuinely different documents apart", () => {
    expect(isSameSource("https://example.gc.ca/a", "https://example.gc.ca/b")).toBe(false);
    expect(isSameSource("https://example.gc.ca/p?id=1", "https://example.gc.ca/p?id=2")).toBe(
      false,
    );
  });
});
