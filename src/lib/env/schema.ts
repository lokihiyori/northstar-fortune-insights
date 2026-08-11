import { z } from "zod";

/**
 * Environment contract.
 *
 * Variables fall into four tiers, because "required" depends on where the
 * process is running and which optional providers are switched on:
 *
 *   (a) Always required        — the app cannot function without them.
 *   (b) Production-only        — a real deployment must have them; local
 *                                development and CI must not be blocked by them.
 *   (c) Provider groups        — all-or-nothing. A half-configured provider is
 *                                worse than an absent one, because it fails at
 *                                the moment a user tries to use it.
 *   (d) Optional               — genuinely optional everywhere.
 *
 * **Errors name the variable and never include its value.** A validation
 * message that echoed a malformed secret would leak it into logs and CI output,
 * which is exactly where secrets should never appear.
 */

/** Rejects values that are obviously placeholders rather than real secrets. */
const PLACEHOLDER = /^(changeme|placeholder|your[-_]?|xxx+|todo|example)/i;

const secret = (minLength: number) =>
  z
    .string()
    .min(minLength, `must be at least ${String(minLength)} characters`)
    .refine((value) => !PLACEHOLDER.test(value), "looks like a placeholder, not a real value");

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // --- (a) Always required -------------------------------------------------
  DATABASE_URL: z.string().url("must be a valid connection URL"),

  // --- (b) Production-only (refined below) ---------------------------------
  // Optional at this level so development and CI builds are not blocked; the
  // superRefine tightens them when actually serving production traffic.
  AUTH_SECRET: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url("must be a valid URL").optional(),

  // --- (c) Provider groups -------------------------------------------------
  AUTH_GOOGLE_ID: z.string().min(1).optional(),
  AUTH_GOOGLE_SECRET: z.string().min(1).optional(),

  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).optional(),

  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PLUS_PRICE_ID: z.string().min(1).optional(),

  // --- (d) Optional --------------------------------------------------------
  // Redis is deliberately optional: retrieval caching is fail-open (ADR 0004),
  // so an absent or unreachable Redis degrades performance, never correctness.
  REDIS_URL: z.string().url("must be a valid Redis URL").optional(),
  DIRECT_DATABASE_URL: z.string().url().optional(),
  SEED_ADMIN: z.string().optional(),

  /**
   * How many trusted proxies sit in front of this process (Phase 8B).
   *
   * Absent or `0` means `X-Forwarded-For` is never believed, which is the safe
   * default and disables per-IP rate limiting. Set it to the real hop count
   * only once a deployment proxy is chosen — a wrong value is worse than none,
   * because it makes a spoofable header look authoritative.
   */
  RATE_LIMIT_TRUSTED_PROXY_HOPS: z
    .string()
    .regex(/^\d+$/, "must be a whole number of proxy hops")
    .optional(),

  /**
   * Recruiter demo mode (Phase 8G). Off unless `DEMO_MODE_ENABLED` is exactly
   * `"true"`, and server-side only — there is deliberately no `NEXT_PUBLIC_`
   * counterpart, because a client-visible flag would be an authorization input
   * the browser controls.
   *
   * The email is the demo identity: it is unique, normalized at both auth
   * entry points, and immutable (nothing in `src` updates `users.email`), so it
   * needs no schema column to be stable.
   */
  DEMO_MODE_ENABLED: z.string().optional(),
  DEMO_ACCOUNT_EMAIL: z.string().optional(),
  DEMO_ACCOUNT_PASSWORD: z.string().optional(),

  /**
   * Explicit acknowledgement required before demo mode may run with
   * `NODE_ENV=production`. Deliberately unset in this phase.
   */
  DEMO_ALLOW_IN_PRODUCTION: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Provider groups that must be configured completely or not at all.
 * Mirrors the runtime guards (`isBillingConfigured`, `isGoogleConfigured`).
 */
const PROVIDER_GROUPS = [
  {
    name: "Stripe billing",
    keys: ["STRIPE_SECRET_KEY", "STRIPE_PLUS_PRICE_ID", "STRIPE_WEBHOOK_SECRET"],
  },
  { name: "Google sign-in", keys: ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"] },
] as const;

/**
 * A single ordinary address. Deliberately stricter than `z.string().email()`:
 * it also rejects SQL/glob wildcards and unexpanded `${VAR}` / `%VAR%` markers,
 * because this value selects the row that `pnpm demo:reset` deletes.
 */
export const DEMO_EMAIL_PATTERN = /^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export type ValidationContext = {
  /**
   * True while `next build` is running. Production *runtime* secrets are not
   * required to compile the application, and demanding them would force CI to
   * hold secrets it has no reason to hold.
   */
  isBuildPhase: boolean;
};

function applyContextRules(env: ServerEnv, ctx: z.RefinementCtx, context: ValidationContext): void {
  // Provider groups apply in every environment.
  for (const group of PROVIDER_GROUPS) {
    const present = group.keys.filter((key) => {
      const value = env[key as keyof ServerEnv];
      return typeof value === "string" && value.length > 0;
    });

    if (present.length > 0 && present.length < group.keys.length) {
      const missing = group.keys.filter((key) => !present.includes(key));
      ctx.addIssue({
        code: "custom",
        path: [missing[0] ?? group.keys[0]],
        message: `${group.name} is partially configured. Set all of ${group.keys.join(", ")} or none of them.`,
      });
    }
  }

  /*
   * Demo mode (Phase 8G) is all-or-nothing in every environment: an enabled
   * flag with no account is a half-configured feature that would render a
   * sign-in button leading nowhere, and an account with the flag off is
   * harmless but worth naming.
   */
  if (env.DEMO_MODE_ENABLED === "true") {
    const email = env.DEMO_ACCOUNT_EMAIL?.trim() ?? "";
    const password = env.DEMO_ACCOUNT_PASSWORD ?? "";

    if (email.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["DEMO_ACCOUNT_EMAIL"],
        message: "is required when DEMO_MODE_ENABLED is true.",
      });
    } else if (!DEMO_EMAIL_PATTERN.test(email)) {
      // Names the rule, never the value.
      ctx.addIssue({
        code: "custom",
        path: ["DEMO_ACCOUNT_EMAIL"],
        message:
          "must be a single ordinary email address — no whitespace, wildcards, or unexpanded template markers.",
      });
    }

    if (password.length < 12) {
      ctx.addIssue({
        code: "custom",
        path: ["DEMO_ACCOUNT_PASSWORD"],
        message: "is required when DEMO_MODE_ENABLED is true and must be at least 12 characters.",
      });
    }
  }

  const isProductionRuntime = env.NODE_ENV === "production" && !context.isBuildPhase;
  if (!isProductionRuntime) return;

  /*
   * A public demo account in production is a deliberate decision, not a
   * default. It is shared, its password lives in configuration, and it is
   * resettable by an operator — all reasonable for a recruiter demo and none of
   * it reasonable by accident.
   */
  if (env.DEMO_MODE_ENABLED === "true" && env.DEMO_ALLOW_IN_PRODUCTION !== "true") {
    ctx.addIssue({
      code: "custom",
      path: ["DEMO_ALLOW_IN_PRODUCTION"],
      message:
        'must be "true" to run demo mode in production. The demo account is shared and resettable; enabling it in production is an explicit decision.',
    });
  }

  // --- (b) Production runtime requirements ---------------------------------
  const authSecret = secret(32).safeParse(env.AUTH_SECRET ?? "");
  if (!authSecret.success) {
    ctx.addIssue({
      code: "custom",
      path: ["AUTH_SECRET"],
      // Reports the rule, never the supplied value.
      message: `is required in production and ${authSecret.error.issues[0]?.message ?? "is invalid"}. Generate one with \`npx auth secret\`.`,
    });
  }

  if (!env.NEXT_PUBLIC_APP_URL) {
    ctx.addIssue({
      code: "custom",
      path: ["NEXT_PUBLIC_APP_URL"],
      message: "is required in production so callback URLs and links resolve correctly.",
    });
  } else {
    const url = new URL(env.NEXT_PUBLIC_APP_URL);
    if (url.protocol !== "https:") {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_APP_URL"],
        message: "must use https in production — secure cookies are not sent over http.",
      });
    }
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_APP_URL"],
        message: "must not point at localhost in production.",
      });
    }
  }
}

/**
 * Only `NEXT_PUBLIC_*` values may cross to the browser. Anything added here is
 * inlined into the client bundle at build time, so it must never hold a secret.
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      [
        "Invalid environment configuration:",
        ...issues.map((issue) => `  - ${issue}`),
        "",
        "Values are never printed. Check .env.example for the expected shape.",
      ].join("\n"),
    );
    this.name = "EnvValidationError";
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const name = issue.path.join(".") || "(root)";
    return `${name} ${issue.message}`;
  });
}

/**
 * Pure parser — takes a record rather than reading `process.env`, so every tier
 * is testable without mutating the ambient environment.
 */
export function parseServerEnv(
  source: Record<string, string | undefined>,
  context: ValidationContext = { isBuildPhase: false },
): ServerEnv {
  const schema = serverEnvSchema.superRefine((env, ctx) => {
    applyContextRules(env, ctx, context);
  });

  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(formatIssues(result.error));
  }
  return result.data;
}

export function parseClientEnv(source: Record<string, string | undefined>): ClientEnv {
  const result = clientEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(formatIssues(result.error));
  }
  return result.data;
}

/** Which optional providers are fully configured. Never exposes any value. */
export function configuredProviders(env: ServerEnv): string[] {
  const enabled: string[] = [];
  if (env.STRIPE_SECRET_KEY && env.STRIPE_PLUS_PRICE_ID && env.STRIPE_WEBHOOK_SECRET) {
    enabled.push("stripe");
  }
  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) enabled.push("google");
  if (env.OPENAI_API_KEY) enabled.push("openai");
  if (env.REDIS_URL) enabled.push("redis");
  return enabled;
}
