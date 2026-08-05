import { describe, expect, it } from "vitest";
import { EnvValidationError, parseClientEnv, parseServerEnv } from "@/lib/env/schema";

describe("parseServerEnv", () => {
  it("accepts a minimal valid environment", () => {
    const env = parseServerEnv({
      DATABASE_URL: "postgresql://northstar:northstar@localhost:5432/northstar",
    });

    expect(env.DATABASE_URL).toBe("postgresql://northstar:northstar@localhost:5432/northstar");
    expect(env.NODE_ENV).toBe("development");
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseServerEnv({})).toThrow(EnvValidationError);
  });

  it("rejects a DATABASE_URL that is not a URL", () => {
    expect(() => parseServerEnv({ DATABASE_URL: "not-a-url" })).toThrow(EnvValidationError);
  });

  it("reports the offending variable name in the error", () => {
    try {
      parseServerEnv({ DATABASE_URL: "postgresql://localhost:5432/db", REDIS_URL: "nope" });
      expect.unreachable("expected parseServerEnv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues.join("\n")).toContain("REDIS_URL");
    }
  });

  it("keeps later-phase provider keys optional", () => {
    const env = parseServerEnv({ DATABASE_URL: "postgresql://localhost:5432/db" });

    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
  });
});

describe("parseClientEnv", () => {
  it("defaults the app URL for local development", () => {
    expect(parseClientEnv({}).NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });

  it("rejects a malformed app URL", () => {
    expect(() => parseClientEnv({ NEXT_PUBLIC_APP_URL: "localhost" })).toThrow(EnvValidationError);
  });
});
