import { describe, expect, it } from "vitest";
import { signInSchema, signUpSchema } from "@/features/auth/validation";

describe("signUpSchema", () => {
  it("lowercases and trims the email so lookups are consistent", () => {
    const result = signUpSchema.parse({
      email: "  Amara@Example.COM ",
      password: "a-long-enough-passphrase",
    });
    expect(result.email).toBe("amara@example.com");
  });

  it("requires at least 12 characters", () => {
    const result = signUpSchema.safeParse({ email: "a@b.co", password: "short" });
    expect(result.success).toBe(false);
  });

  it("accepts a long passphrase containing spaces", () => {
    const result = signUpSchema.safeParse({
      email: "a@b.co",
      password: "correct horse battery staple",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed email", () => {
    expect(
      signUpSchema.safeParse({ email: "not-an-email", password: "a".repeat(12) }).success,
    ).toBe(false);
  });

  it("treats name as optional", () => {
    const result = signUpSchema.safeParse({ email: "a@b.co", password: "a".repeat(12) });
    expect(result.success).toBe(true);
  });
});

describe("signInSchema", () => {
  it("does not impose the length rule on an existing password", () => {
    // Otherwise anyone whose password predates a policy change is locked out.
    const result = signInSchema.safeParse({ email: "a@b.co", password: "old" });
    expect(result.success).toBe(true);
  });

  it("still requires a password to be present", () => {
    expect(signInSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});
