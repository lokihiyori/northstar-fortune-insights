/**
 * The exact state `pnpm demo:reset` produces.
 *
 * Everything here is fictional and non-sensitive by construction: an invented
 * person, a public-knowledge situation, and no contact details, documents,
 * identifiers, or anything a real newcomer would consider private.
 *
 * **Onboarding is complete.** A recruiter has two minutes; spending forty
 * seconds of them typing into a four-step wizard buries the part worth seeing.
 * The wizard stays reachable from the profile page, so it can still be shown on
 * request — the demo starts *ready to Ask*, not unable to onboard.
 */
export const DEMO_PROFILE = {
  name: "Priya (demo)",
  region: "Toronto, Ontario",
  careerStage: "RECENT_GRADUATE",
  currentRole: "Internationally trained accountant, currently in part-time retail work",
  primaryGoal:
    "Get my international accounting credential recognised in Ontario so I can work in my field again",
  timeframe: "WITHIN_1_YEAR",
  notes:
    "Fictional demo profile. Arrived in Canada 8 months ago on a permanent-resident visa. Studying part-time while working evenings.",
} as const;

/** Ranked 1..3. The engine reads rank order, so it must be contiguous. */
export const DEMO_PRIORITIES = [
  { key: "SPEED", rank: 1 },
  { key: "INCOME", rank: 2 },
  { key: "STABILITY", rank: 3 },
] as const;

export const DEMO_CONSTRAINTS = [
  { type: "TIME", value: "About 10 hours a week for study", isHardConstraint: false },
  { type: "BUDGET", value: "Under CAD 3,000 for the first year", isHardConstraint: true },
  {
    type: "WORK_AUTHORIZATION",
    value: "Permanent resident — no work restriction",
    isHardConstraint: false,
  },
] as const;

/**
 * The question the recruiter script asks. Chosen to sit inside the seeded
 * corpus (EDUCATION / Ontario), so the report cites real reviewed passages
 * rather than falling back to exploratory.
 */
export const DEMO_QUESTION =
  "How do I get my international accounting credential recognised so I can work in Ontario?";

/**
 * Onboarding step count that counts as finished. `UserProfile.onboardingStep`
 * holds the highest completed step; the wizard has four.
 */
export const DEMO_ONBOARDING_STEP = 4;
