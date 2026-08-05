/**
 * Structured feedback tags, so ratings are analysable without reading private
 * comments.
 *
 * Kept out of `feedback.ts` deliberately: that file is a `"use server"` module,
 * and every export from one must be an async function. A constant exported from
 * there fails at runtime, not at build time.
 */
export const FEEDBACK_TAGS = [
  "Too generic",
  "Missed a constraint",
  "Evidence was thin",
  "Wrong about my situation",
  "Actions were not practical",
  "Exactly what I needed",
] as const;

export type FeedbackTag = (typeof FEEDBACK_TAGS)[number];
