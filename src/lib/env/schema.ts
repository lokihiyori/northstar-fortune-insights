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

  const isProductionRuntime = env.NODE_ENV === "production" && !context.isBuildPhase;
  if (!isProductionRuntime) return;

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
