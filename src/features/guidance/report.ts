import type { ConfidenceBasis, RecommendationPath, Topic } from "./types";

/**
 * The canonical shape a report takes once it reaches the UI.
 *
 * Phase 3 satisfies this with static fixtures; Phase 4 satisfies it from
 * PostgreSQL. Everything that renders a report depends on this type and not on
 * where it came from, so introducing the guidance engine swaps the loader
 * rather than rewriting the views.
 */
export type ReportStatus = "PENDING" | "RUNNING" | "READY" | "FAILED";

export type GuidanceReportView = {
  id: string;
  requestId: string;
  version: number;
  status: ReportStatus;
  topic: Topic;
  title: string;
  question: string;
  questionRestatement: string;
  summary: string;
  confidenceBasis: ConfidenceBasis;
  confidenceReasons: string[];
  missingInformation: string[];
  paths: RecommendationPath[];
  disclaimer: string;
  createdAt: string;
  /** Present once the user has converted a path into a plan. */
  planId?: string | undefined;
  archivedAt?: string | undefined;
};

export type ReportSummaryView = Pick<
  GuidanceReportView,
  "id" | "topic" | "title" | "question" | "status" | "createdAt" | "version" | "archivedAt"
> & {
  selectedPathTitle: string | null;
  pathCount: number;
  evidenceCount: number;
};

export function toSummary(report: GuidanceReportView): ReportSummaryView {
  return {
    id: report.id,
    topic: report.topic,
    title: report.title,
    question: report.question,
    status: report.status,
    createdAt: report.createdAt,
    version: report.version,
    archivedAt: report.archivedAt,
    selectedPathTitle: report.paths[0]?.title ?? null,
    pathCount: report.paths.length,
    evidenceCount: report.paths.reduce((total, path) => total + path.evidence.length, 0),
  };
}

export function findPath(report: GuidanceReportView, pathId: string | undefined) {
  if (!pathId) return report.paths[0];
  return report.paths.find((path) => path.id === pathId) ?? report.paths[0];
}

/** Reports are grouped by month in history; this is the label for that group. */
export function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatReportDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
