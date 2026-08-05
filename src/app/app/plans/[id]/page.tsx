import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { ProgressRing } from "@/components/ui/progress-ring";
import { requireUser } from "@/features/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { addCheckIn, setTaskStatus } from "@/features/plans/actions";
import { TASK_STATUS_COPY, type TaskStatus } from "@/features/plans/types";

export const metadata: Metadata = { title: "Action plan" };

const MILESTONES = [30, 60, 90] as const;

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/app/plans/${id}`);

  const plan = await prisma.actionPlan.findFirst({
    where: { id, userId: user.id, deletedAt: null },
    include: {
      tasks: { orderBy: [{ milestone: "asc" }, { position: "asc" }] },
      checkIns: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!plan) notFound();

  const done = plan.tasks.filter((task) => task.status === "DONE").length;
  // Spec section 5.7: progress counts completed tasks only.
  const percent = plan.tasks.length === 0 ? 0 : Math.round((done / plan.tasks.length) * 100);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Badge tone="teal">{plan.status === "ACTIVE" ? "Active plan" : plan.status}</Badge>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{plan.title}</h1>
          <p className="text-text-secondary mt-2 max-w-2xl">{plan.desiredOutcome}</p>
        </div>
        <ProgressRing
          percent={percent}
          label={`${String(done)} of ${String(plan.tasks.length)} done`}
        />
      </header>

      <div className="mt-10 space-y-8">
        {MILESTONES.map((milestone) => {
          const tasks = plan.tasks.filter((task) => task.milestone === milestone);
          if (tasks.length === 0) return null;

          return (
            <section key={milestone} aria-labelledby={`milestone-${String(milestone)}`}>
              <h2
                id={`milestone-${String(milestone)}`}
                className="text-lg font-semibold tracking-tight"
              >
                First {milestone} days
              </h2>

              <ul className="mt-4 space-y-3">
                {tasks.map((task) => {
                  const complete = task.status === "DONE";
                  return (
                    <li
                      key={task.id}
                      className="border-border bg-surface rounded-card flex items-start gap-4 border p-4"
                    >
                      <form action={setTaskStatus} className="pt-0.5">
                        <input type="hidden" name="taskId" value={task.id} />
                        <input type="hidden" name="status" value={complete ? "TODO" : "DONE"} />
                        <button
                          type="submit"
                          aria-label={
                            complete
                              ? `Mark "${task.title}" as to do`
                              : `Mark "${task.title}" as done`
                          }
                          className={
                            complete
                              ? "border-brand-teal bg-brand-teal flex size-5 items-center justify-center rounded border text-xs text-white"
                              : "border-border hover:border-brand-teal flex size-5 items-center justify-center rounded border"
                          }
                        >
                          {complete ? "✓" : ""}
                        </button>
                      </form>

                      <div className="min-w-0 flex-1">
                        <p
                          className={
                            complete
                              ? "text-text-secondary text-sm line-through"
                              : "text-sm font-medium"
                          }
                        >
                          {task.title}
                        </p>
                        <p className="text-text-secondary mt-1 text-sm">{task.description}</p>
                        <p className="text-text-secondary mt-2 text-xs">
                          {TASK_STATUS_COPY[task.status as TaskStatus]}
                          {task.dueDate
                            ? ` · due ${task.dueDate.toLocaleDateString("en-CA", { day: "numeric", month: "short" })}`
                            : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <section aria-labelledby="checkin-heading" className="border-border mt-12 border-t pt-8">
        <h2 id="checkin-heading" className="text-lg font-semibold tracking-tight">
          Weekly reflection
        </h2>
        <p className="text-text-secondary mt-2 text-sm">
          What changed since your last plan? Recording it is how the plan stays honest.
        </p>

        <form action={addCheckIn} className="mt-4 space-y-3">
          <input type="hidden" name="planId" value={plan.id} />
          <div>
            <label htmlFor="note" className="block text-sm font-medium">
              What happened
            </label>
            <textarea
              id="note"
              name="note"
              rows={3}
              required
              className="rounded-control border-border bg-surface mt-1.5 w-full border px-3.5 py-2.5 text-base sm:text-sm"
            />
          </div>
          <div>
            <label htmlFor="changedContext" className="block text-sm font-medium">
              Anything that changed in your situation{" "}
              <span className="text-text-secondary">(optional)</span>
            </label>
            <input
              id="changedContext"
              name="changedContext"
              className="rounded-control border-border bg-surface mt-1.5 h-11 w-full border px-3.5 text-base sm:text-sm"
            />
          </div>
          <Button type="submit">Save reflection</Button>
        </form>

        {plan.checkIns.length > 0 ? (
          <ul className="mt-8 space-y-4">
            {plan.checkIns.map((checkIn) => (
              <li key={checkIn.id} className="border-border border-l-2 pl-4">
                <p className="text-sm">{checkIn.note}</p>
                {checkIn.changedContext ? (
                  <p className="text-text-secondary mt-1 text-sm">
                    Changed: {checkIn.changedContext}
                  </p>
                ) : null}
                <p className="text-text-secondary mt-1 text-xs">
                  {checkIn.createdAt.toLocaleDateString("en-CA", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="mt-10">
        <ButtonLink href={`/app/insights/${plan.reportId}`} variant="secondary">
          Back to the insight
        </ButtonLink>
      </div>
    </div>
  );
}
