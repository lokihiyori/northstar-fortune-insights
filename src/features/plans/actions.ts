"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/features/auth/guards";
import { recordEvent } from "@/features/analytics/events";
import { getEntitlements } from "@/features/billing/entitlements";
import { prisma } from "@/lib/db/prisma";

/**
 * Converts one recommendation path into an action plan (spec section 5.7).
 *
 * The path's suggested actions become tasks, bucketed into 30/60/90-day
 * milestones by their target day.
 */
export async function createPlanFromPath(formData: FormData): Promise<void> {
  const user = await requireUser("/app");
  const reportId = String(formData.get("reportId") ?? "");
  const pathId = String(formData.get("pathId") ?? "");

  if (!reportId || !pathId) redirect("/app/history");

  // Ownership is re-checked here rather than trusted from the form.
  const path = await prisma.recommendationPath.findFirst({
    where: { id: pathId, report: { id: reportId, userId: user.id, deletedAt: null } },
    include: {
      actions: { orderBy: { position: "asc" } },
      report: { select: { summary: true } },
    },
  });
  if (!path) redirect("/app/history");

  const existing = await prisma.actionPlan.findUnique({
    where: { userId_pathId: { userId: user.id, pathId } },
    select: { id: true },
  });
  if (existing) redirect(`/app/plans/${existing.id}`);

  const entitlements = await getEntitlements(user.id);
  const activePlans = await prisma.actionPlan.count({
    where: { userId: user.id, status: "ACTIVE", deletedAt: null },
  });
  if (activePlans >= entitlements.maxActivePlans) {
    redirect("/app/history?error=plan-limit");
  }

  const plan = await prisma.actionPlan.create({
    data: {
      userId: user.id,
      reportId,
      pathId,
      title: path.title,
      desiredOutcome: path.report.summary,
      status: "ACTIVE",
      tasks: {
        create: path.actions.map((action, index) => ({
          title: action.title,
          description: action.description,
          milestone: action.targetDays <= 30 ? 30 : action.targetDays <= 60 ? 60 : 90,
          dueDate: new Date(Date.now() + action.targetDays * 24 * 60 * 60 * 1000),
          position: index,
        })),
      },
    },
    select: { id: true },
  });

  await recordEvent("plan_created", user.id, { taskCount: path.actions.length });

  revalidatePath("/app");
  redirect(`/app/plans/${plan.id}`);
}

export async function setTaskStatus(formData: FormData): Promise<void> {
  const user = await requireUser("/app");
  const taskId = String(formData.get("taskId") ?? "");
  const status = String(formData.get("status") ?? "");

  const allowed = ["TODO", "IN_PROGRESS", "DONE", "BLOCKED"] as const;
  if (!allowed.includes(status as (typeof allowed)[number])) return;

  // Scoped through the plan's owner so a forged taskId cannot touch another
  // account's plan.
  const task = await prisma.planTask.findFirst({
    where: { id: taskId, plan: { userId: user.id, deletedAt: null } },
    select: { id: true, planId: true },
  });
  if (!task) return;

  await prisma.planTask.update({
    where: { id: task.id },
    data: { status: status as (typeof allowed)[number] },
  });

  if (status === "DONE") await recordEvent("task_completed", user.id);

  revalidatePath(`/app/plans/${task.planId}`);
  revalidatePath("/app");
}

export async function addCheckIn(formData: FormData): Promise<void> {
  const user = await requireUser("/app");
  const planId = String(formData.get("planId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const changedContext = String(formData.get("changedContext") ?? "").trim();

  if (!note) return;

  const plan = await prisma.actionPlan.findFirst({
    where: { id: planId, userId: user.id, deletedAt: null },
    select: { id: true },
  });
  if (!plan) return;

  await prisma.planCheckIn.create({
    data: {
      planId: plan.id,
      note: note.slice(0, 2000),
      changedContext: changedContext ? changedContext.slice(0, 500) : null,
    },
  });

  revalidatePath(`/app/plans/${plan.id}`);
}
