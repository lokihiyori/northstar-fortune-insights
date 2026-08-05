export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED";

export const TASK_STATUS_COPY: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  BLOCKED: "Blocked",
};

/** Spec section 5.7: milestones are grouped into 30, 60, and 90-day horizons. */
export type Milestone = 30 | 60 | 90;

export type PlanTaskView = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  milestone: Milestone;
  dueDate: string | null;
  notes: string | null;
  /** Source this task came from, when it was derived from cited evidence. */
  relatedSourceId: string | null;
};

export type CheckInView = {
  id: string;
  note: string;
  changedContext: string | null;
  createdAt: string;
};

export type ActionPlanView = {
  id: string;
  reportId: string;
  pathId: string;
  title: string;
  desiredOutcome: string;
  status: "ACTIVE" | "ARCHIVED" | "COMPLETED";
  targetDate: string | null;
  createdAt: string;
  tasks: PlanTaskView[];
  checkIns: CheckInView[];
};

/**
 * Progress counts completed tasks only — spec section 5.7 is explicit that the
 * ring must not be inflated by partial or in-progress work.
 */
export function planProgress(plan: ActionPlanView): {
  done: number;
  total: number;
  percent: number;
} {
  const total = plan.tasks.length;
  const done = plan.tasks.filter((task) => task.status === "DONE").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, percent };
}

export function tasksForMilestone(plan: ActionPlanView, milestone: Milestone): PlanTaskView[] {
  return plan.tasks.filter((task) => task.milestone === milestone);
}

export function nextAction(plan: ActionPlanView): PlanTaskView | null {
  const open = plan.tasks
    .filter((task) => task.status !== "DONE")
    .sort((a, b) => a.milestone - b.milestone);
  return open[0] ?? null;
}
