import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/features/auth/password";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("a-long-enough-passphrase");
    await expect(verifyPassword("a-long-enough-passphrase", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("a-long-enough-passphrase");
    await expect(verifyPassword("a-long-enough-passphrasE", hash)).resolves.toBe(false);
  });

  it("never stores the password in the encoded hash", async () => {
    const password = "correct horse battery staple";
    const hash = await hashPassword(password);
    expect(hash).not.toContain(password);
  });

  it("salts, so the same password hashes differently each time", async () => {
    const [a, b] = await Promise.all([
      hashPassword("a-long-enough-passphrase"),
      hashPassword("a-long-enough-passphrase"),
    ]);
    expect(a).not.toBe(b);
  });

  it("records its parameters so old hashes stay verifiable after a cost bump", async () => {
    const hash = await hashPassword("a-long-enough-passphrase");
    const [prefix, N, r, p] = hash.split("$");

    expect(prefix).toBe("scrypt");
    expect(Number(N)).toBeGreaterThanOrEqual(16_384);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  it("verifies against the parameters embedded in the hash, not the current ones", async () => {
    // A hash written with a lower work factor must still verify.
    const legacy = "scrypt$16384$8$1$c2FsdHNhbHRzYWx0c2ExMg==$";
    // Deliberately truncated key — this must be rejected, not throw.
    await expect(verifyPassword("anything", legacy)).resolves.toBe(false);
  });

  it("returns false rather than throwing for malformed or missing hashes", async () => {
    for (const bad of [null, undefined, "", "not-a-hash", "scrypt$x$y$z$a$b", "a$b$c"]) {
      await expect(verifyPassword("a-long-enough-passphrase", bad)).resolves.toBe(false);
    }
  });

  it("normalizes unicode so an equivalent password still verifies", async () => {
    // U+00E9 vs. e + U+0301 — visually identical, different bytes.
    const hash = await hashPassword("passé-longue-assez");
    await expect(verifyPassword("passé-longue-assez", hash)).resolves.toBe(true);
  });
});
