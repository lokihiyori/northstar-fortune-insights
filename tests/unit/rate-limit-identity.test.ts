import { describe, expect, it } from "vitest";
import {
  digestIdentifier,
  digestIp,
  normalizeIdentifier,
  parseProxyTrust,
  resolveClientIp,
} from "@/lib/rate-limit/identity";

/**
 * Identity is where the privacy and trust guarantees live, so these tests are
 * written as the guarantees themselves: nothing readable reaches a key, and a
 * forwarding header is only believed when a deployment says it can be.
 */

const SECRET = "unit-test-secret-value-not-a-real-credential";

function headersWith(forwardedFor?: string): Headers {
  const headers = new Headers();
  if (forwardedFor !== undefined) headers.set("x-forwarded-for", forwardedFor);
  return headers;
}

describe("normalizeIdentifier", () => {
  it("folds case and trims, so obvious variants share one bucket", () => {
    expect(normalizeIdentifier("  Person@Example.COM ")).toBe("person@example.com");
  });

  it("does not collapse plus tags or dots into a different account", () => {
    // The application treats these as separate accounts. Collapsing them would
    // let attempts against one account exhaust another person's allowance.
    expect(normalizeIdentifier("a+tag@example.com")).toBe("a+tag@example.com");
    expect(normalizeIdentifier("f.i.r.s.t@example.com")).toBe("f.i.r.s.t@example.com");
  });
});

describe("digestIdentifier", () => {
  it("never contains the address, its local part, or its domain", () => {
    const email = "someone.private@example.com";
    const digest = digestIdentifier(normalizeIdentifier(email), SECRET);

    expect(digest).not.toContain("someone");
    expect(digest).not.toContain("private");
    expect(digest).not.toContain("example.com");
    expect(digest).not.toContain("@");
    expect(digest).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is stable for the same address and different for another", () => {
    expect(digestIdentifier("a@example.com", SECRET)).toBe(
      digestIdentifier("a@example.com", SECRET),
    );
    expect(digestIdentifier("a@example.com", SECRET)).not.toBe(
      digestIdentifier("b@example.com", SECRET),
    );
  });

  it("is keyed, so the same address digests differently under another secret", () => {
    // An unkeyed hash of an email is reversible with a wordlist, which would
    // turn a Redis keyspace dump back into a list of who tried to sign in.
    expect(digestIdentifier("a@example.com", SECRET)).not.toBe(
      digestIdentifier("a@example.com", "a-completely-different-secret"),
    );
  });

  it("still produces a usable digest with no secret configured", () => {
    // Development often has no AUTH_SECRET; limiting must not silently stop.
    expect(digestIdentifier("a@example.com", undefined)).toMatch(/^[0-9a-f]{32}$/);
    expect(digestIdentifier("a@example.com", "")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not leak the secret itself", () => {
    expect(digestIdentifier("a@example.com", SECRET)).not.toContain(SECRET);
  });
});

describe("digestIp", () => {
  it("never contains the address it was derived from", () => {
    const digest = digestIp("203.0.113.42", SECRET);
    expect(digest).not.toContain("203.0.113.42");
    expect(digest).not.toContain("203");
    expect(digest).toMatch(/^[0-9a-f]{32}$/);
  });

  it("separates the address and identifier namespaces", () => {
    // Otherwise a subject that is an address could collide with one that is an
    // account, merging two people's budgets.
    expect(digestIp("value", SECRET)).not.toBe(digestIdentifier("value", SECRET));
  });
});

describe("parseProxyTrust", () => {
  it("defaults to trusting nothing", () => {
    expect(parseProxyTrust(undefined).trustedHops).toBe(0);
    expect(parseProxyTrust("").trustedHops).toBe(0);
    expect(parseProxyTrust("0").trustedHops).toBe(0);
  });

  it("ignores values that are not whole positive numbers", () => {
    for (const raw of ["yes", "-1", "1.5", "NaN", "1; drop"]) {
      expect(parseProxyTrust(raw).trustedHops, raw).toBe(0);
    }
  });

  it("caps absurd values rather than trusting an arbitrary depth", () => {
    expect(parseProxyTrust("2").trustedHops).toBe(2);
    expect(parseProxyTrust("9999").trustedHops).toBe(8);
  });
});

describe("resolveClientIp — untrusted (the default)", () => {
  const untrusted = { trustedHops: 0 };

  it("ignores X-Forwarded-For entirely", () => {
    expect(resolveClientIp(headersWith("203.0.113.9"), untrusted)).toBeNull();
  });

  it("cannot be fooled by a spoofed chain", () => {
    const spoofed = headersWith("1.1.1.1, 2.2.2.2, 3.3.3.3");
    expect(resolveClientIp(spoofed, untrusted)).toBeNull();
  });

  it("returns null rather than a shared placeholder", () => {
    // A shared bucket would let one caller exhaust every user's allowance.
    expect(resolveClientIp(headersWith(), untrusted)).toBeNull();
  });
});

describe("resolveClientIp — trusted proxy", () => {
  it("takes the entry the nearest trusted proxy appended", () => {
    // client, proxy2, proxy1 -> with one trusted hop, the rightmost entry is
    // the address our own proxy observed.
    const headers = headersWith("198.51.100.7, 203.0.113.1");
    expect(resolveClientIp(headers, { trustedHops: 1 })).toBe("203.0.113.1");
  });

  it("counts further left as more proxies are declared", () => {
    const headers = headersWith("198.51.100.7, 203.0.113.1, 203.0.113.2");
    expect(resolveClientIp(headers, { trustedHops: 2 })).toBe("203.0.113.1");
    expect(resolveClientIp(headers, { trustedHops: 3 })).toBe("198.51.100.7");
  });

  it("returns null when the chain is shorter than the declared hop count", () => {
    // A misconfigured hop count must not silently fall back to a client-written
    // entry, which is exactly the value it was configured to distrust.
    expect(resolveClientIp(headersWith("198.51.100.7"), { trustedHops: 3 })).toBeNull();
  });

  it("rejects entries that are not addresses", () => {
    for (const value of ["unknown", "not-an-ip", "999.1.1.1", "<script>"]) {
      expect(resolveClientIp(headersWith(value), { trustedHops: 1 }), value).toBeNull();
    }
  });

  it("handles IPv6, including the bracketed form with a port", () => {
    expect(resolveClientIp(headersWith("2001:db8::1"), { trustedHops: 1 })).toBe("2001:db8::1");
    expect(resolveClientIp(headersWith("[2001:db8::1]:443"), { trustedHops: 1 })).toBe(
      "2001:db8::1",
    );
  });

  it("returns null when the header is absent", () => {
    expect(resolveClientIp(headersWith(), { trustedHops: 1 })).toBeNull();
  });
});
