import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { UsageMeter } from "@/components/ui/usage-meter";
import { CompassPreview } from "@/components/onboarding/compass-preview";
import { requireUser } from "@/features/auth/guards";
import { getEntitlements } from "@/features/billing/entitlements";
import { listReportsForUser } from "@/features/guidance/queries";
import { formatReportDate } from "@/features/guidance/report";
import { countReportsThisPeriod } from "@/features/guidance/usage";
import { TOPIC_COPY } from "@/features/guidance/types";
import { compassCompletion, getCompassProfile } from "@/features/onboarding/queries";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser("/app");
  const profile = await getCompassProfile(user.id);

  // A brand-new account has nothing to show, so send it to onboarding.
  if (!profile.onboardingCompletedAt && profile.onboardingStep === 0) {
    redirect("/app/onboarding");
  }

  const [reports, entitlements, used, activePlan] = await Promise.all([
    listReportsForUser(user.id),
    getEntitlements(user.id),
    countReportsThisPeriod(user.id),
    prisma.actionPlan.findFirst({
      where: { userId: user.id, status: "ACTIVE", deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { tasks: { orderBy: [{ milestone: "asc" }, { position: "asc" }] } },
    }),
  ]);

  const completion = compassCompletion(profile);
  const firstName = user.name?.split(" ")[0] ?? null;
  const nextTask = activePlan?.tasks.find((task) => task.status !== "DONE") ?? null;
  const recent = reports.slice(0, 4);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
      </h1>
      <p className="text-text-secondary mt-2">
        {reports.length === 0
          ? "Your workspace is ready. Start with the decision that is actually on your mind."
          : "Pick up where you left off, or ask something new."}
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          {!profile.onboardingCompletedAt ? (
            <Card raised>
              <CardTitle>Finish building your compass</CardTitle>
              <CardBody className="mt-2">
                You are {completion}% of the way there. The more NorthStar knows about your
                constraints, the fewer assumptions it has to make.
              </CardBody>
              <ButtonLink href="/app/onboarding" className="mt-5">
                Continue setup
              </ButtonLink>
            </Card>
          ) : null}

          {activePlan && nextTask ? (
            <Card>
              <p className="text-text-secondary text-xs font-medium tracking-wide uppercase">
                Next best action
              </p>
              <CardTitle className="mt-2">{nextTask.title}</CardTitle>
              <CardBody className="mt-2">{nextTask.description}</CardBody>
              <div className="mt-5 flex flex-wrap gap-3">
                <ButtonLink href={`/app/plans/${activePlan.id}`} size="sm">
                  Open your plan
                </ButtonLink>
                {nextTask.dueDate ? (
                  <span className="text-text-secondary self-center text-sm">
                    Due{" "}
                    {nextTask.dueDate.toLocaleDateString("en-CA", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                ) : null}
              </div>
            </Card>
          ) : null}

          <section aria-labelledby="recent-heading">
            <div className="flex items-center justify-between gap-4">
              <h2 id="recent-heading" className="text-lg font-semibold tracking-tight">
                Recent insights
              </h2>
              {reports.length > 0 ? (
                <Link
                  href="/app/history"
                  className="text-brand-teal text-sm font-medium hover:underline"
                >
                  View all
                </Link>
              ) : null}
            </div>

            {recent.length === 0 ? (
              <EmptyState
                className="mt-4"
                title="No insights yet"
                description="Ask about a decision you are facing. You will get three paths with their reasoning, evidence, and trade-offs — not one confident answer."
                action={<ButtonLink href="/app/ask">Ask your first question</ButtonLink>}
              />
            ) : (
              <ul className="mt-4 space-y-3">
                {recent.map((report) => (
                  <li key={report.id}>
                    <Link
                      href={`/app/insights/${report.id}`}
                      className="border-border bg-surface hover:bg-surface-raised rounded-card block border p-4 transition-colors duration-150"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="teal">{TOPIC_COPY[report.topic]}</Badge>
                        <span className="text-text-secondary text-xs">
                          {formatReportDate(report.createdAt)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium">{report.question}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6 lg:col-span-5">
          <UsageMeter used={used} allowance={entitlements.monthlyReports} />
          <CompassPreview profile={profile} completion={completion} />
        </aside>
      </div>
    </div>
  );
}
