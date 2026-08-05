import { guidanceReportSchema, type GeneratedReport } from "./schema";

export type ValidationFailure = {
  code: "SCHEMA_INVALID" | "UNKNOWN_CITATION" | "EMPTY_EVIDENCE_STRONG_CLAIM";
  message: string;
  details: string[];
};

export type ValidationResult =
  { ok: true; report: GeneratedReport } | { ok: false; failure: ValidationFailure };

/**
 * Validates raw provider output.
 *
 * Two gates, in order:
 *   1. The strict schema. Malformed output is rejected outright, never repaired.
 *   2. The citation allow-list. Every `sourceId` must appear in the evidence
 *      packet actually retrieved for this request — a model that invents a
 *      plausible-looking ID is the single most damaging failure this product
 *      can have, so an unknown citation fails the whole report rather than
 *      being quietly dropped.
 */
export function validateGeneratedReport(
  raw: unknown,
  allowedSourceIds: ReadonlySet<string>,
): ValidationResult {
  const parsed = guidanceReportSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      ok: false,
      failure: {
        code: "SCHEMA_INVALID",
        message: "The generated report did not match the required structure.",
        details: parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        ),
      },
    };
  }

  const unknown: string[] = [];
  for (const path of parsed.data.paths) {
    for (const item of path.evidence) {
      if (!allowedSourceIds.has(item.sourceId)) {
        unknown.push(`${path.id} cites unknown source "${item.sourceId}"`);
      }
    }
  }

  if (unknown.length > 0) {
    return {
      ok: false,
      failure: {
        code: "UNKNOWN_CITATION",
        message: "The generated report cited a source that was not retrieved.",
        details: unknown,
      },
    };
  }

  return { ok: true, report: parsed.data };
}
