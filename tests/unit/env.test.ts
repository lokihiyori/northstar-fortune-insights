import { describe, expect, it } from "vitest";
import {
  EnvValidationError,
  configuredProviders,
  parseClientEnv,
  parseServerEnv,
} from "@/lib/env/schema";

const VALID_DB = "postgresql://northstar:northstar@127.0.0.1:55432/northstar";
// Long enough to satisfy the production rule; not a real secret.
const VALID_AUTH_SECRET = "unit-test-secret-value-of-sufficient-length";

function base(overrides: Record<string, string | undefined> = {}) {
  return { DATABASE_URL: VALID_DB, ...overrides };
}

function expectFailure(
  source: Record<string, string | undefined>,
  context?: { isBuildPhase: boolean },
): EnvValidationError {
  try {
    parseServerEnv(source, context);
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error("expected parseServerEnv to throw");
}

describe("(a) always required", () => {
  it("accepts a minimal development environment", () => {
    const env = parseServerEnv(base());
    expect(env.DATABASE_URL).toBe(VALID_DB);
    expect(env.NODE_ENV).toBe("development");
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(expectFailure({}).issues.join(" ")).toContain("DATABASE_URL");
  });

  it("rejects a malformed DATABASE_URL", () => {
    expect(expectFailure(base({ DATABASE_URL: "not-a-url" })).issues.join(" ")).toContain(
      "DATABASE_URL",
    );
  });
});

describe("(b) production-only requirements", () => {
  const production = { NODE_ENV: "production" };

  it("requires AUTH_SECRET when serving production", () => {
    const issues = expectFailure(base(production)).issues.join(" ");
    expect(issues).toContain("AUTH_SECRET");
  });

  it("rejects an AUTH_SECRET that is too short to be real entropy", () => {
    const issues = expectFailure(base({ ...production, AUTH_SECRET: "short" })).issues.join(" ");
    expect(issues).toContain("AUTH_SECRET");
  });

  it("rejects an obvious placeholder secret", () => {
    const issues = expectFailure(
      base({ ...production, AUTH_SECRET: "changeme-changeme-changeme-changeme" }),
    ).issues.join(" ");
    expect(issues).toContain("AUTH_SECRET");
  });

  it("requires a production app URL that is https and not localhost", () => {
    for (const url of ["http://northstar.example.com", "https://localhost:3000"]) {
      const issues = expectFailure(
        base({ ...production, AUTH_SECRET: VALID_AUTH_SECRET, NEXT_PUBLIC_APP_URL: url }),
      ).issues.join(" ");
      expect(issues).toContain("NEXT_PUBLIC_APP_URL");
    }
  });

  it("accepts a complete production environment", () => {
    const env = parseServerEnv(
      base({
        ...production,
        AUTH_SECRET: VALID_AUTH_SECRET,
        NEXT_PUBLIC_APP_URL: "https://northstar.example.com",
      }),
    );
    expect(env.NODE_ENV).toBe("production");
  });

  it("does NOT demand production runtime secrets during next build", () => {
    // A build must not require secrets it has no reason to hold — otherwise CI
    // would have to carry AUTH_SECRET purely to compile.
    const env = parseServerEnv(base(production), { isBuildPhase: true });
    expect(env.AUTH_SECRET).toBeUndefined();
  });
});

describe("(c) provider groups are all-or-nothing", () => {
  it("rejects partially configured Stripe", () => {
    const issues = expectFailure(base({ STRIPE_SECRET_KEY: "present" })).issues.join(" ");
    expect(issues).toContain("Stripe");
  });

  it("accepts Stripe when every variable is present", () => {
    expect(
      parseServerEnv(
        base({
          STRIPE_SECRET_KEY: "present",
          STRIPE_PLUS_PRICE_ID: "present",
          STRIPE_WEBHOOK_SECRET: "present",
        }),
      ).STRIPE_SECRET_KEY,
    ).toBe("present");
  });

  it("rejects a half-configured Google provider", () => {
    expect(expectFailure(base({ AUTH_GOOGLE_ID: "present" })).issues.join(" ")).toContain("Google");
  });

  it("reports which providers are enabled without exposing values", () => {
    const env = parseServerEnv(
      base({ OPENAI_API_KEY: "a-secret-value", REDIS_URL: "redis://h:1" }),
    );
    const providers = configuredProviders(env);

    expect(providers).toContain("openai");
    expect(providers).toContain("redis");
    expect(providers.join(" ")).not.toContain("a-secret-value");
  });
});

describe("(d) optional providers never block local deterministic mode", () => {
  it("starts with no Stripe, OpenAI, Google, or Redis configured", () => {
    // This is exactly how the demo runs: deterministic provider, no billing.
    const env = parseServerEnv(base());

    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.AUTH_GOOGLE_ID).toBeUndefined();
    expect(env.REDIS_URL).toBeUndefined();
    expect(configuredProviders(env)).toEqual([]);
  });

  it("starts in production with optional providers absent", () => {
    const env = parseServerEnv(
      base({
        NODE_ENV: "production",
        AUTH_SECRET: VALID_AUTH_SECRET,
        NEXT_PUBLIC_APP_URL: "https://northstar.example.com",
      }),
    );
    expect(configuredProviders(env)).toEqual([]);
  });
});

describe("error messages never leak values", () => {
  it("names the variable but not its content", () => {
    const leaky = "super-secret-do-not-print-me";
    const error = expectFailure(base({ NODE_ENV: "production", AUTH_SECRET: leaky.slice(0, 5) }));

    expect(error.issues.join(" ")).toContain("AUTH_SECRET");
    expect(error.message).not.toContain(leaky.slice(0, 5));
  });

  it("does not echo a malformed URL back", () => {
    const bad = "postgres://user:hunter2@host/db-but-invalid-scheme";
    const error = expectFailure({ DATABASE_URL: "not-a-url", DIRECT_DATABASE_URL: bad });
    expect(error.message).not.toContain("hunter2");
  });
});

describe("parseClientEnv", () => {
  it("defaults the app URL for local development", () => {
    expect(parseClientEnv({}).NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });

  it("rejects a malformed app URL", () => {
    expect(() => parseClientEnv({ NEXT_PUBLIC_APP_URL: "localhost" })).toThrow(EnvValidationError);
  });

  it("only accepts NEXT_PUBLIC_ variables, so no secret can reach the bundle", () => {
    const parsed = parseClientEnv({
      NEXT_PUBLIC_APP_URL: "https://northstar.example.com",
      AUTH_SECRET: "must-not-appear",
    } as Record<string, string>);

    expect(JSON.stringify(parsed)).not.toContain("must-not-appear");
  });
});
