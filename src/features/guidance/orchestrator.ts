import "server-only";

import { prisma } from "@/lib/db/prisma";
import { resolveEmbedder, resolveProvider } from "./ai";
import { PROMPT_NAME, PROMPT_VERSION } from "./ai/prompt";
import { withTimeout, type GuidanceProvider } from "./ai/provider";
import { deriveConfidence, evaluateRules, isBlocked, missingInformationFrom } from "./rules";
import { validateGeneratedReport } from "./validation";
import {
  allowedSourceIds,
  retrieveEvidence,
  type EvidenceChunk,
} from "@/features/retrieval/repository";
import type { GuidanceInput } from "./rules/types";
import type { GeneratedReport } from "./schema";

export const GENERATION_TIMEOUT_MS = 45_000;

/**
 * The request pipeline from spec section 9.
 *
 * Deterministic code owns permissions, validation, retrieval, citation checking,
 * and persistence. The model is one step in the middle, and its output is
 * untrusted until it has passed both validation gates.
 *
 * Stage indices line up with GENERATION_STAGES in composer.ts so the client can
 * name the current step without the server leaking anything else.
 */
const STAGE = {
  STRUCTURING: 0,
  RULES: 1,
  RETRIEVAL: 2,
  GENERATION: 3,
  VALIDATION: 4,
} as const;

export type RunResult =
  { ok: true; reportId: string } | { ok: false; code: string; message: string };

async function setStage(requestId: string, stageIndex: number): Promise<void> {
  await prisma.guidanceRequest.update({
    where: { id: requestId },
    data: { stageIndex, status: "RUNNING" },
  });
}

async function fail(requestId: string, code: string, message: string): Promise<RunResult> {
  await prisma.guidanceRequest.update({
    where: { id: requestId },
    data: { status: "FAILED", errorCode: code, errorMessage: message, completedAt: new Date() },
  });
  return { ok: false, code, message };
}

export async function runGuidancePipeline(
  requestId: string,
  input: GuidanceInput,
  provider: GuidanceProvider = resolveProvider(),
): Promise<RunResult> {
  const startedAt = Date.now();

  try {
    // 1–3. Normalize and structure. Validation of the raw request already
    // happened at the API boundary.
    await setStage(requestId, STAGE.STRUCTURING);

    // 4. Deterministic rules run before anything is generated.
    await setStage(requestId, STAGE.RULES);
    const ruleResults = evaluateRules(input);

    const blocking = isBlocked(ruleResults);
    if (blocking) {
      // A refusal is a legitimate outcome, not an error: the user gets a clear
      // boundary rather than a personalized directive on a high-stakes topic.
      return await fail(
        requestId,
        "OUT_OF_SCOPE",
        blocking.message ?? "This question is outside what NorthStar can advise on.",
      );
    }

    // 5–7. Embed, then retrieve only PUBLISHED sources for this topic/region.
    await setStage(requestId, STAGE.RETRIEVAL);
    const embedder = resolveEmbedder();
    const [queryEmbedding] = await embedder.embed([input.question]);

    let evidence: EvidenceChunk[] = [];
    if (queryEmbedding) {
      evidence = await retrieveEvidence(queryEmbedding, {
        topic: input.topic,
        region: input.includeProfile ? input.profile.region : null,
      });
    }

    // 8–9. Bounded evidence packet, then generation under a timeout.
    await setStage(requestId, STAGE.GENERATION);
    const outcome = await withTimeout(
      provider.generate({ input, evidence, timeoutMs: GENERATION_TIMEOUT_MS }),
      GENERATION_TIMEOUT_MS,
      () => ({ ok: false as const, code: "TIMEOUT" as const, message: "Generation timed out." }),
    );

    if (!outcome.ok) {
      return await fail(requestId, outcome.code, providerMessage(outcome.code));
    }

    // 10–11. Schema validation, then the citation allow-list.
    await setStage(requestId, STAGE.VALIDATION);
    const validation = validateGeneratedReport(outcome.raw, allowedSourceIds(evidence));

    if (!validation.ok) {
      // Details go to the server log, never to the user.
      console.error(
        `Guidance validation failed (${validation.failure.code}) for request ${requestId}:`,
        validation.failure.details,
      );
      return await fail(
        requestId,
        validation.failure.code,
        "The generated insight did not pass validation, so it was discarded.",
      );
    }

    // 12. Persist the report, its paths, and its citations atomically.
    const { basis, reasons } = deriveConfidence(ruleResults, evidence.length);
    const reportId = await persistReport({
      requestId,
      report: validation.report,
      evidence,
      confidenceBasis: basis,
      confidenceReasons: reasons,
      ruleMissingInformation: missingInformationFrom(ruleResults),
      modelName: outcome.modelName,
    });

    await prisma.guidanceRequest.update({
      where: { id: requestId },
      data: {
        status: "READY",
        stageIndex: STAGE.VALIDATION + 1,
        completedAt: new Date(),
        latencyMs: Date.now() - startedAt,
      },
    });

    return { ok: true, reportId };
  } catch (error) {
    console.error(`Guidance pipeline crashed for request ${requestId}:`, error);
    return await fail(requestId, "INTERNAL", "Something went wrong while preparing your insight.");
  }
}

function providerMessage(code: string): string {
  if (code === "TIMEOUT") return "The analysis took too long and was stopped.";
  if (code === "RATE_LIMITED") return "The service is busy right now. Please try again shortly.";
  return "The analysis could not be completed.";
}

async function persistReport(args: {
  requestId: string;
  report: GeneratedReport;
  evidence: readonly EvidenceChunk[];
  confidenceBasis: "HIGH_EVIDENCE" | "MISSING_INFORMATION" | "EXPLORATORY";
  confidenceReasons: string[];
  ruleMissingInformation: string[];
  modelName: string;
}): Promise<string> {
  const request = await prisma.guidanceRequest.findUniqueOrThrow({
    where: { id: args.requestId },
    select: { userId: true, reports: { select: { version: true } } },
  });

  const nextVersion = request.reports.reduce((max, report) => Math.max(max, report.version), 0) + 1;

  // chunkId is resolved from the evidence packet rather than trusted from the
  // model — the model only ever names a sourceId.
  const chunkBySource = new Map(args.evidence.map((chunk) => [chunk.sourceId, chunk.chunkId]));

  const missingInformation = [
    ...new Set([...args.report.missingInformation, ...args.ruleMissingInformation]),
  ];

  return prisma.$transaction(async (tx) => {
    const report = await tx.guidanceReport.create({
      data: {
        requestId: args.requestId,
        userId: request.userId,
        version: nextVersion,
        title: args.report.title,
        questionRestatement: args.report.questionRestatement,
        summary: args.report.summary,
        disclaimer: args.report.disclaimer,
        confidenceBasis: args.confidenceBasis,
        confidenceReasons: args.confidenceReasons,
        missingInformation,
        // Snapshot of what the model was shown, so this version stays
        // reproducible even after a source is edited or retired.
        evidenceSnapshot: args.evidence.map((chunk) => ({
          sourceId: chunk.sourceId,
          chunkId: chunk.chunkId,
          similarity: chunk.similarity,
        })),
        modelName: args.modelName,
        promptVersion: `${PROMPT_NAME}@${String(PROMPT_VERSION)}`,
      },
      select: { id: true },
    });

    for (const [index, path] of args.report.paths.entries()) {
      const created = await tx.recommendationPath.create({
        data: {
          reportId: report.id,
          label: path.label,
          title: path.title,
          fit: path.fit,
          timeHorizon: path.timeHorizon,
          mainTradeoff: path.mainTradeoff,
          position: index,
        },
        select: { id: true },
      });

      const reasons = [
        ...path.rationale.map((body, position) => ({ type: "RATIONALE" as const, body, position })),
        ...path.assumptions.map((body, position) => ({
          type: "ASSUMPTION" as const,
          body,
          position,
        })),
        ...path.tradeoffs.map((body, position) => ({ type: "TRADEOFF" as const, body, position })),
        ...path.changeConditions.map((body, position) => ({
          type: "CHANGE_CONDITION" as const,
          body,
          position,
        })),
      ];

      await tx.pathReason.createMany({
        data: reasons.map((reason) => ({ ...reason, pathId: created.id })),
      });

      await tx.pathAction.createMany({
        data: path.nextActions.map((action, position) => ({
          pathId: created.id,
          title: action.title,
          description: action.description,
          targetDays: action.targetDays,
          position,
        })),
      });

      if (path.evidence.length > 0) {
        await tx.citation.createMany({
          data: path.evidence.map((item, position) => ({
            pathId: created.id,
            sourceId: item.sourceId,
            chunkId: chunkBySource.get(item.sourceId) ?? null,
            claim: item.claim,
            position,
          })),
        });
      }
    }

    return report.id;
  });
}
