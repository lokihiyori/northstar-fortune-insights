import { SAMPLE_REPORTS } from "./sample-data";
import type { GuidanceReportView } from "./report";
import type { ActionPlanView } from "@/features/plans/types";

/**
 * Phase 3 fixtures for the authenticated app.
 *
 * These reuse the hand-written sample reports rather than duplicating their
 * prose, and adapt them to `GuidanceReportView` — the same type Phase 4 loads
 * from PostgreSQL. Building the UI against this contract means the engine can
 * be introduced by swapping the loader.
 *
 * Dates are fixed rather than relative so snapshots and tests stay stable.
 */
const BASE_DATES = [
  "2026-07-28T14:10:00.000Z",
  "2026-07-14T09:30:00.000Z",
  "2026-06-30T17:45:00.000Z",
];

export const FIXTURE_REPORTS: readonly GuidanceReportView[] = SAMPLE_REPORTS.map(
  (sample, index): GuidanceReportView => ({
    id: sample.id,
    requestId: `req-${sample.id}`,
    version: 1,
    status: "READY",
    topic: sample.topic,
    title: sample.profile.headline,
    question: sample.question,
    questionRestatement: sample.summary,
    summary: sample.summary,
    confidenceBasis: sample.confidenceBasis,
    confidenceReasons: [...sample.confidenceReasons],
    missingInformation: [...sample.missingInformation],
    paths: sample.paths.map((path) => ({ ...path })),
    disclaimer: sample.disclaimer,
    createdAt: BASE_DATES[index] ?? BASE_DATES[0]!,
    planId: index === 0 ? "plan-newcomer-accounting" : undefined,
  }),
);

export const FIXTURE_PLANS: readonly ActionPlanView[] = [
  {
    id: "plan-newcomer-accounting",
    reportId: "sample-newcomer-accounting",
    pathId: "path-cpa-bridge",
    title: "Take a staff accounting role while pursuing CPA recognition",
    desiredOutcome: "Working in accounting in Ontario, with a clear route to the CPA designation.",
    status: "ACTIVE",
    targetDate: "2027-07-28",
    createdAt: "2026-07-28T14:22:00.000Z",
    tasks: [
      {
        id: "task-recognition",
        title: "Confirm your recognition pathway",
        description:
          "Check whether your issuing body appears on CPA Canada's international agreements list. This single answer changes the length of every other step.",
        status: "DONE",
        milestone: 30,
        dueDate: "2026-08-04",
        notes: "Body appears on the reciprocal list — the bridge is shorter than expected.",
        relatedSourceId: "src-cpa-intl",
      },
      {
        id: "task-assessment",
        title: "Start a credential assessment",
        description:
          "Begin an assessment through a recognized service. Processing takes weeks, so starting early removes it from the critical path.",
        status: "IN_PROGRESS",
        milestone: 30,
        dueDate: "2026-08-11",
        notes: null,
        relatedSourceId: "src-oncred",
      },
      {
        id: "task-apply",
        title: "Apply to five staff accounting roles",
        description:
          "Target mid-size firms and industry finance teams, which weigh hands-on experience more heavily than title continuity.",
        status: "TODO",
        milestone: 60,
        dueDate: "2026-08-27",
        notes: null,
        relatedSourceId: null,
      },
      {
        id: "task-network",
        title: "Speak to two internationally trained accountants in Ontario",
        description:
          "Ask specifically what they would do differently. This is the validation step the report cannot do for you.",
        status: "TODO",
        milestone: 60,
        dueDate: null,
        notes: null,
        relatedSourceId: null,
      },
      {
        id: "task-enroll",
        title: "Enrol in the first CPA module",
        description: "Only once the recognition pathway is confirmed, so no module is wasted.",
        status: "TODO",
        milestone: 90,
        dueDate: null,
        notes: null,
        relatedSourceId: "src-cpa-intl",
      },
    ],
    checkIns: [
      {
        id: "checkin-1",
        note: "Recognition confirmed. Feeling more certain about the timeline than I did last week.",
        changedContext: "Credential body is on the reciprocal list.",
        createdAt: "2026-08-02T10:00:00.000Z",
      },
    ],
  },
];

export function getFixtureReport(id: string): GuidanceReportView | undefined {
  return FIXTURE_REPORTS.find((report) => report.id === id);
}

export function getFixturePlan(id: string): ActionPlanView | undefined {
  return FIXTURE_PLANS.find((plan) => plan.id === id);
}

export function getFixturePlanForReport(reportId: string): ActionPlanView | undefined {
  return FIXTURE_PLANS.find((plan) => plan.reportId === reportId);
}
