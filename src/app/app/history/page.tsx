import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { requireUser } from "@/features/auth/guards";
import { listReportsForUser } from "@/features/guidance/queries";
import { formatReportDate, monthLabel } from "@/features/guidance/report";
import { TOPIC_COPY } from "@/features/guidance/types";

export const metadata: Metadata = { title: "History" };

export default async function HistoryPage() {
  const user = await requireUser("/app/history");
  const reports = await listReportsForUser(user.id);

  if (reports.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Your history</h1>
        <EmptyState
          className="mt-8"
          title="No insights yet"
          description="Once you ask your first question, every report you generate is saved here — including earlier versions, so you can see how your thinking changed."
          action={<ButtonLink href="/app/ask">Ask your first question</ButtonLink>}
        />
      </div>
    );
  }

  // Grouped by month so a long history stays scannable.
  const groups = new Map<string, typeof reports>();
  for (const report of reports) {
    const key = monthLabel(report.createdAt);
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your history</h1>
        <ButtonLink href="/app/ask" size="sm">
          New question
        </ButtonLink>
      </div>

      <div className="mt-8 space-y-10">
        {[...groups.entries()].map(([month, items]) => (
          <section key={month} aria-labelledby={`month-${month.replace(/\s/g, "-")}`}>
            <h2
              id={`month-${month.replace(/\s/g, "-")}`}
              className="text-text-secondary text-xs font-medium tracking-wide uppercase"
            >
              {month}
            </h2>

            <ul className="mt-3 space-y-3">
              {items.map((report) => (
                <li key={report.id}>
                  <Link
                    href={`/app/insights/${report.id}`}
                    className="border-border bg-surface hover:bg-surface-raised rounded-card block border p-5 transition-colors duration-150"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="teal">{TOPIC_COPY[report.topic]}</Badge>
                      {report.version > 1 ? <Badge>Version {report.version}</Badge> : null}
                      <span className="text-text-secondary text-xs">
                        {formatReportDate(report.createdAt)}
                      </span>
                    </div>

                    <p className="mt-3 font-medium">{report.question}</p>
                    {report.selectedPathTitle ? (
                      <p className="text-text-secondary mt-1 text-sm">
                        Best fit: {report.selectedPathTitle}
                      </p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
