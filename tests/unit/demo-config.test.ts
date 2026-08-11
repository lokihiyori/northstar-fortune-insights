import { describe, expect, it } from "vitest";
import {
  demoAccountEmail,
  demoAccountPassword,
  demoAllowedInProduction,
  demoModeConfigured,
  demoModeEnabled,
  isDemoEmail,
  isReservedDemoEmail,
  normalizeDemoEmail,
} from "@/features/demo/config";

/**
 * Demo status is a server-side decision. These tests pass an explicit env
 * object rather than mutating `process.env`, which also proves the module takes
 * its answer from configuration rather than from anything ambient.
 */
const enabled = {
  DEMO_MODE_ENABLED: "true",
  DEMO_ACCOUNT_EMAIL: "demo@northstar.local",
  DEMO_ACCOUNT_PASSWORD: "a-long-enough-passphrase",
} as unknown as NodeJS.ProcessEnv;

const disabled = { ...enabled, DEMO_MODE_ENABLED: "false" } as unknown as NodeJS.ProcessEnv;

describe("demo mode flag", () => {
  it("is off when unset", () => {
    expect(demoModeEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('is on only for the exact string "true"', () => {
    for (const value of ["1", "yes", "TRUE", "True", " true", "true "]) {
      const env = { DEMO_MODE_ENABLED: value } as unknown as NodeJS.ProcessEnv;
      expect(demoModeEnabled(env), value).toBe(false);
    }
    expect(demoModeEnabled({ DEMO_MODE_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(
      true,
    );
  });

  it("reports configured only when flag, email, and password are all present", () => {
    expect(demoModeConfigured(enabled)).toBe(true);
    expect(demoModeConfigured(disabled)).toBe(false);
    expect(
      demoModeConfigured({ ...enabled, DEMO_ACCOUNT_PASSWORD: "" } as unknown as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      demoModeConfigured({ ...enabled, DEMO_ACCOUNT_EMAIL: "  " } as unknown as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});

describe("demo identity", () => {
  it("normalizes case and surrounding whitespace", () => {
    expect(normalizeDemoEmail("  Demo@NorthStar.Local ")).toBe("demo@northstar.local");
    expect(normalizeDemoEmail("")).toBeNull();
    expect(normalizeDemoEmail(undefined)).toBeNull();
  });

  it("matches the configured address regardless of casing or padding", () => {
    for (const candidate of [
      "demo@northstar.local",
      "DEMO@NORTHSTAR.LOCAL",
      " Demo@Northstar.Local ",
    ]) {
      expect(isDemoEmail(candidate, enabled), candidate).toBe(true);
    }
  });

  it("does not match a look-alike address", () => {
    for (const candidate of [
      "demo@northstar.local.evil.com",
      "demo+1@northstar.local",
      "dem0@northstar.local",
      "@northstar.local",
      "",
      null,
      undefined,
    ]) {
      expect(isDemoEmail(candidate, enabled), String(candidate)).toBe(false);
    }
  });

  it("treats nobody as the demo user when the mode is off", () => {
    // The banner and every demo denial hang off this, so an off switch must
    // genuinely mean off.
    expect(isDemoEmail("demo@northstar.local", disabled)).toBe(false);
    expect(demoAccountEmail(disabled)).toBeNull();
    expect(demoAccountPassword(disabled)).toBeNull();
  });

  it("still reserves the address against sign-up when the mode is off", () => {
    // Otherwise turning demo mode on later could collide with an account a
    // stranger registered in the meantime, and the reset would then be aimed at
    // a real person's row.
    expect(isReservedDemoEmail("demo@northstar.local", disabled)).toBe(true);
    expect(isReservedDemoEmail("DEMO@northstar.local", disabled)).toBe(true);
    expect(isReservedDemoEmail("someone@example.com", disabled)).toBe(false);
  });

  it("reserves nothing when no address is configured", () => {
    expect(isReservedDemoEmail("demo@northstar.local", {} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("production acknowledgement", () => {
  it('is false unless explicitly set to "true"', () => {
    expect(demoAllowedInProduction({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      demoAllowedInProduction({ DEMO_ALLOW_IN_PRODUCTION: "yes" } as unknown as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      demoAllowedInProduction({ DEMO_ALLOW_IN_PRODUCTION: "true" } as unknown as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
