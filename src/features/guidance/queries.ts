import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { GuidanceReportView, ReportSummaryView } from "./report";
import type { ConfidenceBasis, Fit, PathLabel, RecommendationPath, Topic } from "./types";

/**
 * Read models for the app. Every query is scoped by userId — ownership is
 * enforced in the query itself, so a wrong id is indistinguishable from a
 * missing one and cannot leak another account's report.
 */
export async function getRequestForUser(requestId: string, userId: string) {
  return prisma.guidanceRequest.findFirst({
    where: { id: requestId, userId },
    select: {
      id: true,
      status: true,
      stageIndex: true,
      errorMessage: true,
      reports: { orderBy: { version: "desc" }, take: 1, select: { id: true } },
    },
  });
}

const reportInclude = {
  request: { select: { topic: true, question: true } },
  plans: { where: { deletedAt: null }, select: { id: true }, take: 1 },
  paths: {
    orderBy: { position: "asc" },
    include: {
      reasons: { orderBy: { position: "asc" } },
      actions: { orderBy: { position: "asc" } },
      citations: {
        orderBy: { position: "asc" },
        include: {
          source: { select: { title: true, publisher: true, region: true, canonicalUrl: true } },
        },
      },
    },
  },
} as const;

type ReportRow = NonNullable<
  Awaited<ReturnType<typeof prisma.guidanceReport.findFirst<{ include: typeof reportInclude }>>>
>;

function toView(row: ReportRow): GuidanceReportView {
  const paths: RecommendationPath[] = row.paths.map((path) => {
    const byType = (type: "RATIONALE" | "ASSUMPTION" | "TRADEOFF" | "CHANGE_CONDITION") =>
      path.reasons.filter((reason) => reason.type === type).map((reason) => reason.body);

    return {
      id: path.id,
      label: path.label as PathLabel,
      title: path.title,
      fit: path.fit as Fit,
      timeHorizon: path.timeHorizon,
      mainTradeoff: path.mainTradeoff,
      rationale: byType("RATIONALE"),
      assumptions: byType("ASSUMPTION"),
      tradeoffs: byType("TRADEOFF"),
      changeConditions: byType("CHANGE_CONDITION"),
      supportingConstraintIds: [],
      evidence: path.citations.map((citation) => ({
        sourceId: citation.sourceId,
        claim: citation.claim,
        publisher: citation.source.publisher,
        region: citation.source.region,
        url: citation.source.canonicalUrl,
      })),
      nextActions: path.actions.map((action) => ({
        title: action.title,
        description: action.description,
        targetDays: action.targetDays,
      })),
    };
  });

  return {
    id: row.id,
    requestId: row.requestId,
    version: row.version,
    status: "READY",
    topic: row.request.topic as Topic,
    title: row.title,
    question: row.request.question,
    questionRestatement: row.questionRestatement,
    summary: row.summary,
    confidenceBasis: row.confidenceBasis as ConfidenceBasis,
    confidenceReasons: row.confidenceReasons,
    missingInformation: row.missingInformation,
    paths,
    disclaimer: row.disclaimer,
    createdAt: row.createdAt.toISOString(),
    planId: row.plans[0]?.id,
    archivedAt: row.archivedAt?.toISOString(),
  };
}

export async function getReportForUser(
  reportId: string,
  userId: string,
): Promise<GuidanceReportView | null> {
  const row = await prisma.guidanceReport.findFirst({
    where: { id: reportId, userId, deletedAt: null },
    include: reportInclude,
  });
  return row ? toView(row) : null;
}

/** Latest version of the report produced by a request. */
export async function getLatestReportForRequest(
  requestId: string,
  userId: string,
): Promise<GuidanceReportView | null> {
  const row = await prisma.guidanceReport.findFirst({
    where: { requestId, userId, deletedAt: null },
    orderBy: { version: "desc" },
    include: reportInclude,
  });
  return row ? toView(row) : null;
}

export async function listReportsForUser(
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<ReportSummaryView[]> {
  const rows = await prisma.guidanceReport.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      version: true,
      createdAt: true,
      archivedAt: true,
      request: { select: { topic: true, question: true } },
      paths: { orderBy: { position: "asc" }, take: 1, select: { title: true } },
      _count: { select: { paths: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    topic: row.request.topic as Topic,
    title: row.title,
    question: row.request.question,
    status: "READY" as const,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
    archivedAt: row.archivedAt?.toISOString(),
    selectedPathTitle: row.paths[0]?.title ?? null,
    pathCount: row._count.paths,
    // Counted separately would be another query per row; the report page shows
    // the exact figure, and history only needs to know whether any exist.
    evidenceCount: 0,
  }));
}
