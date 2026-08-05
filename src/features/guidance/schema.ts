import { z } from "zod";

/**
 * The strict contract the model must satisfy (spec section 9).
 *
 * Nothing reaches the UI or the database before passing this. Anything the
 * schema rejects is a failed generation, not something to repair by hand —
 * silently patching malformed output is how fabricated content gets in.
 */
const nonEmpty = z.string().trim().min(1);

export const guidanceEvidenceSchema = z.object({
  sourceId: nonEmpty,
  claim: nonEmpty.max(400),
});

export const guidanceActionSchema = z.object({
  title: nonEmpty.max(120),
  description: nonEmpty.max(600),
  targetDays: z.number().int().min(1).max(365),
});

export const guidancePathSchema = z.object({
  id: nonEmpty.max(64),
  label: z.enum(["BEST_FIT", "LOWER_RISK", "GROWTH"]),
  title: nonEmpty.max(160),
  fit: z.enum(["STRONG", "MODERATE", "EXPLORATORY"]),
  timeHorizon: nonEmpty.max(80),
  mainTradeoff: nonEmpty.max(240),
  rationale: z.array(nonEmpty.max(400)).min(1).max(5),
  assumptions: z.array(nonEmpty.max(400)).max(5),
  tradeoffs: z.array(nonEmpty.max(400)).min(1).max(5),
  changeConditions: z.array(nonEmpty.max(400)).min(1).max(5),
  evidence: z.array(guidanceEvidenceSchema).max(6),
  nextActions: z.array(guidanceActionSchema).min(1).max(5),
});

export const guidanceReportSchema = z
  .object({
    title: nonEmpty.max(160),
    summary: nonEmpty.max(600),
    questionRestatement: nonEmpty.max(400),
    missingInformation: z.array(nonEmpty.max(300)).max(6),
    // Exactly three, and they must be distinct kinds — spec section 5.5.
    paths: z.array(guidancePathSchema).length(3),
    disclaimer: nonEmpty.max(400),
  })
  .superRefine((report, ctx) => {
    const labels = report.paths.map((path) => path.label);
    if (new Set(labels).size !== labels.length) {
      ctx.addIssue({
        code: "custom",
        path: ["paths"],
        message: "The three paths must use distinct labels.",
      });
    }

    const ids = report.paths.map((path) => path.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["paths"], message: "Path ids must be unique." });
    }

    // A path with no evidence cannot claim a strong fit. This is the rule the
    // product's credibility rests on, so it is enforced structurally rather
    // than left to the prompt.
    report.paths.forEach((path, index) => {
      if (path.evidence.length === 0 && path.fit === "STRONG") {
        ctx.addIssue({
          code: "custom",
          path: ["paths", index, "fit"],
          message: "A path with no supporting evidence cannot be a STRONG fit.",
        });
      }
    });
  });

export type GeneratedReport = z.infer<typeof guidanceReportSchema>;
export type GeneratedPath = z.infer<typeof guidancePathSchema>;

/** JSON Schema handed to the provider for structured output. */
export const GUIDANCE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "summary",
    "questionRestatement",
    "missingInformation",
    "paths",
    "disclaimer",
  ],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    questionRestatement: { type: "string" },
    missingInformation: { type: "array", items: { type: "string" } },
    disclaimer: { type: "string" },
    paths: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "label",
          "title",
          "fit",
          "timeHorizon",
          "mainTradeoff",
          "rationale",
          "assumptions",
          "tradeoffs",
          "changeConditions",
          "evidence",
          "nextActions",
        ],
        properties: {
          id: { type: "string" },
          label: { type: "string", enum: ["BEST_FIT", "LOWER_RISK", "GROWTH"] },
          title: { type: "string" },
          fit: { type: "string", enum: ["STRONG", "MODERATE", "EXPLORATORY"] },
          timeHorizon: { type: "string" },
          mainTradeoff: { type: "string" },
          rationale: { type: "array", items: { type: "string" } },
          assumptions: { type: "array", items: { type: "string" } },
          tradeoffs: { type: "array", items: { type: "string" } },
          changeConditions: { type: "array", items: { type: "string" } },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sourceId", "claim"],
              properties: { sourceId: { type: "string" }, claim: { type: "string" } },
            },
          },
          nextActions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "description", "targetDays"],
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                targetDays: { type: "integer" },
              },
            },
          },
        },
      },
    },
  },
} as const;
