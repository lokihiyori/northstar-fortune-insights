import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecommendationMap } from "@/components/guidance/recommendation-map";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { requireUser } from "@/features/auth/guards";
import { getReportForUser } from "@/features/guidance/queries";
import { formatReportDate } from "@/features/guidance/report";
import { CONFIDENCE_COPY, TOPIC_COPY } from "@/features/guidance/types";
import { createPlanFromPath } from "@/features/plans/actions";

export const metadata: Metadata = { title: "Insight" };

export default async function InsightPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/app/insights/${id}`);

  const report = await getReportForUser(id, user.id);
  if (!report) notFound();

  const bestPath = report.paths[0];
  const evidenceCount = report.paths.reduce((total, path) => total + path.evidence.length, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="teal">{TOPIC_COPY[report.topic]}</Badge>
          <Badge>Version {report.version}</Badge>
          <Badge>{formatReportDate(report.createdAt)}</Badge>
        </div>

        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{report.question}</h1>
        <p className="text-text-secondary mt-3 max-w-3xl">{report.summary}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          {report.planId ? (
            <ButtonLink href={`/app/plans/${report.planId}`}>Open your action plan</ButtonLink>
          ) : bestPath ? (
            <form action={createPlanFromPath}>
              <input type="hidden" name="reportId" value={report.id} />
              <input type="hidden" name="pathId" value={bestPath.id} />
              <Button type="submit">Create an action plan</Button>
            </form>
          ) : null}

          <ButtonLink href={`/app/compare/${report.id}`} variant="secondary">
            Compare the paths
          </ButtonLink>
        </div>
      </header>

      <section
        aria-labelledby="confidence-heading"
        className="border-border bg-surface rounded-card mt-8 border p-5"
      >
        <h2 id="confidence-heading" className="text-sm font-semibold">
          Confidence: {CONFIDENCE_COPY[report.confidenceBasis]}
        </h2>
        {/* Spec section 5.5: never a confidence label without its basis. */}
        <ul className="mt-3 space-y-1.5">
          {report.confidenceReasons.map((reason) => (
            <li key={reason} className="text-text-secondary flex gap-2 text-sm">
              <span
                aria-hidden="true"
                className="bg-brand-teal mt-2 size-1 shrink-0 rounded-full"
              />
              {reason}
            </li>
          ))}
        </ul>
        <p className="text-text-secondary mt-4 text-xs">
          {evidenceCount} cited {evidenceCount === 1 ? "passage" : "passages"} across{" "}
          {report.paths.length} paths.
        </p>
      </section>

      {report.missingInformation.length > 0 ? (
        <section
          aria-labelledby="missing-heading"
          className="border-warning/30 bg-warning/5 rounded-card mt-6 border p-5"
        >
          <h2 id="missing-heading" className="text-sm font-semibold">
            What NorthStar still does not know
          </h2>
          <ul className="mt-3 space-y-1.5">
            {report.missingInformation.map((item) => (
              <li key={item} className="text-text-secondary flex gap-2 text-sm">
                <span aria-hidden="true" className="bg-warning mt-2 size-1 shrink-0 rounded-full" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="paths-heading" className="mt-8">
        <h2 id="paths-heading" className="sr-only">
          Recommended paths
        </h2>
        <RecommendationMap report={report} />
      </section>

      <footer className="border-border mt-8 border-t pt-6">
        <p className="text-text-secondary text-sm">{report.disclaimer}</p>
        <p className="mt-4 text-sm">
          <Link href="/app/history" className="text-brand-teal font-medium hover:underline">
            Back to your history
          </Link>
        </p>
      </footer>
    </div>
  );
}
