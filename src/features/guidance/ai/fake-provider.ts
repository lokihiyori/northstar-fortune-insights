import type { GenerationOutcome, GenerationRequest, GuidanceProvider } from "./provider";
import type { GeneratedPath, GeneratedReport } from "../schema";

/**
 * Deterministic provider used in development, tests, and CI.
 *
 * It is not a stub that returns a canned blob: it composes a schema-valid report
 * from the actual question, criteria, constraints, and retrieved evidence, and
 * cites only source IDs that were genuinely retrieved. That makes the whole
 * pipeline — rules, retrieval, validation, persistence, polling — exercisable
 * end to end with no provider, no key, and no cost.
 *
 * Its prose is intentionally generic. The point is a truthful *shape*, not
 * insight; anything that reads as real analysis here would be misleading.
 */
export const fakeProvider: GuidanceProvider = {
  name: "fake-deterministic-v1",
  generate: (request: GenerationRequest): Promise<GenerationOutcome> =>
    Promise.resolve({
      ok: true,
      raw: buildReport(request),
      modelName: "fake-deterministic-v1",
      latencyMs: 0,
    }),
};

function topCriteria(request: GenerationRequest): string {
  const sorted = [...request.input.criteria].sort((a, b) => b.weight - a.weight);
  const names = sorted.slice(0, 2).map((item) => item.key.toLowerCase().replace(/_/g, " "));
  return names.length > 0 ? names.join(" and ") : "the factors you listed";
}

function hardConstraintNote(request: GenerationRequest): string | null {
  const hard = request.input.constraints.filter((constraint) => constraint.isHard);
  if (hard.length === 0) return null;
  return `Respects your stated ${hard.map((c) => c.type.toLowerCase().replace(/_/g, " ")).join(" and ")} constraint.`;
}

function buildReport(request: GenerationRequest): GeneratedReport {
  const { input, evidence } = request;
  const criteria = topCriteria(request);
  const constraintNote = hardConstraintNote(request);
  const hasEvidence = evidence.length > 0;

  // Evidence is spread across paths so no single path hoards the citations.
  const forPath = (index: number) =>
    evidence
      .filter((_, position) => position % 3 === index)
      .slice(0, 2)
      .map((chunk) => ({
        sourceId: chunk.sourceId,
        claim: `${chunk.publisher} publishes material relevant to this decision for ${chunk.region}.`,
      }));

  const paths: GeneratedPath[] = [
    {
      id: "path-best-fit",
      label: "BEST_FIT",
      title: `Pursue the most direct route, prioritising ${criteria}`,
      fit: hasEvidence ? "STRONG" : "EXPLORATORY",
      timeHorizon: input.profile.timeframe ? "Aligned to your stated timeframe" : "6–12 months",
      mainTradeoff: "Requires sustained effort early, before results are visible.",
      rationale: [
        `This route weights ${criteria} most heavily, which is what you said matters.`,
        ...(constraintNote ? [constraintNote] : []),
        hasEvidence
          ? "Reviewed public sources describe this as an established route."
          : "No reviewed source matched closely, so this is a starting point rather than a recommendation.",
      ],
      assumptions: [
        "Your situation stays broadly as described over the next few months.",
        "You can act on the first steps without waiting for an external decision.",
      ],
      tradeoffs: [
        "Concentrates effort in one direction, so switching later costs time.",
        "Front-loads the difficult work.",
      ],
      changeConditions: [
        "New information about eligibility or requirements would change the sequence.",
        "A change in your timeframe would reorder these steps.",
      ],
      evidence: forPath(0),
      nextActions: [
        {
          title: "Verify the single biggest unknown",
          description:
            "Identify the one fact that changes the most about this path, and confirm it with the relevant official body before investing further.",
          targetDays: 7,
        },
        {
          title: "Talk to two people already on this path",
          description:
            "Ask what they would do differently. This is the validation a generated report cannot do for you.",
          targetDays: 21,
        },
      ],
    },
    {
      id: "path-lower-risk",
      label: "LOWER_RISK",
      title: "Take the incremental route that preserves your current position",
      fit: hasEvidence ? "MODERATE" : "EXPLORATORY",
      timeHorizon: "3–6 months to first result",
      mainTradeoff: "Slower ceiling in exchange for far less downside.",
      rationale: [
        "Keeps your current situation intact while you test the direction.",
        "Produces a usable result sooner, which reduces the cost of being wrong.",
      ],
      assumptions: ["You can make incremental progress alongside current commitments."],
      tradeoffs: [
        "Lower ceiling than the direct route.",
        "Progress can stall if it is never prioritised.",
      ],
      changeConditions: [
        "If your available time increases, the direct route becomes more attractive.",
      ],
      evidence: forPath(1),
      nextActions: [
        {
          title: "Define what a successful test looks like",
          description:
            "Write down, in advance, what result would convince you to commit and what would convince you to stop.",
          targetDays: 14,
        },
      ],
    },
    {
      id: "path-growth",
      label: "GROWTH",
      title: "Pursue the higher-variance option with the larger payoff",
      fit: "EXPLORATORY",
      timeHorizon: "12–24 months",
      mainTradeoff: "The least certain of the three, and the slowest to pay off.",
      rationale: [
        "Offers the largest change in position if the assumptions hold.",
        "Builds capability that transfers even if this specific path does not work out.",
      ],
      assumptions: [
        "You have, or can create, tolerance for a longer period without a clear result.",
      ],
      tradeoffs: [
        "Longest time before you know whether it is working.",
        "Competes for the same hours as the other two.",
      ],
      changeConditions: [
        "Evidence that the payoff is smaller than assumed would remove the reason to choose this.",
        "Increased financial pressure would make this the first path to defer.",
      ],
      evidence: forPath(2),
      nextActions: [
        {
          title: "Cost the first three months honestly",
          description:
            "Write down the time and money this needs before any return. If that number is unacceptable, this path is already ruled out.",
          targetDays: 30,
        },
      ],
    },
  ];

  return {
    title: `Paths for your ${input.topic.toLowerCase().replace(/_/g, " ")} decision`,
    questionRestatement: input.question.trim().slice(0, 400),
    summary: hasEvidence
      ? `Three routes, ordered by ${criteria}. The evidence supports the general shape of each, but the choice between them depends on trade-offs only you can weigh.`
      : `Three routes, ordered by ${criteria}. No reviewed source matched this question closely, so all three are exploratory and should be checked before you act on them.`,
    missingInformation: hasEvidence
      ? ["Specific details of your situation that were not captured in your compass."]
      : [
          "No reviewed source matched this question, so nothing here is source-backed.",
          "Specific details of your situation that were not captured in your compass.",
        ],
    paths,
    disclaimer:
      "This is general educational guidance, not professional advice. Confirm requirements with the relevant official body before acting.",
  };
}

/** Failure-injecting providers, used by tests to cover the unhappy paths. */
export function failingProvider(
  code: "TIMEOUT" | "PROVIDER_ERROR" | "RATE_LIMITED" | "NOT_CONFIGURED",
): GuidanceProvider {
  return {
    name: `fake-failing-${code.toLowerCase()}`,
    generate: () => Promise.resolve({ ok: false, code, message: `Injected ${code} for testing.` }),
  };
}

/** Returns output that is well-formed but cites a source that was never retrieved. */
export function hallucinatingProvider(fabricatedSourceId = "src-does-not-exist"): GuidanceProvider {
  return {
    name: "fake-hallucinating",
    generate: async (request) => {
      const outcome = await fakeProvider.generate(request);
      if (!outcome.ok) return outcome;

      const report = outcome.raw as GeneratedReport;
      const [first, ...rest] = report.paths;
      if (!first) return outcome;

      return {
        ...outcome,
        raw: {
          ...report,
          paths: [
            {
              ...first,
              evidence: [{ sourceId: fabricatedSourceId, claim: "A confidently stated claim." }],
            },
            ...rest,
          ],
        },
      };
    },
  };
}
