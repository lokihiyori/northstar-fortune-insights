/**
 * The event catalogue (spec section 14).
 *
 * Deliberately separate from the recorder: this is a pure shared contract with
 * no database import, so it can be referenced from anywhere and asserted in
 * tests without a running PostgreSQL.
 */
export const EVENT_NAMES = [
  "signup_completed",
  "onboarding_completed",
  "question_started",
  "guidance_requested",
  "guidance_completed",
  "guidance_failed",
  "path_selected",
  "plan_created",
  "task_completed",
  "check_in_completed",
  "report_feedback_submitted",
  "report_archived",
  "report_regenerated",
  "upgrade_started",
  "subscription_activated",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** Only primitives, so a whole object of private text cannot be passed by accident. */
export type EventProperties = Record<string, string | number | boolean | null>;

/**
 * Property names suggesting private content. Analytics must explain product
 * behaviour without recording what a user actually wrote.
 */
export const FORBIDDEN_PROPERTY_KEYS = /question|comment|note|prose|summary|text|email|password/i;

export function stripPrivateProperties(properties: EventProperties): EventProperties {
  const safe: EventProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (FORBIDDEN_PROPERTY_KEYS.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}
