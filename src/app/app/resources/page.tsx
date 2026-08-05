import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { requireUser } from "@/features/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { TOPIC_COPY, type Topic } from "@/features/guidance/types";

export const metadata: Metadata = { title: "Resources" };

export default async function AppResourcesPage() {
  await requireUser("/app/resources");

  // Only PUBLISHED sources are ever shown, matching what retrieval may use.
  const sources = await prisma.source.findMany({
    where: { status: "PUBLISHED", deletedAt: null },
    orderBy: [{ topic: "asc" }, { publisher: "asc" }],
    select: {
      id: true,
      title: true,
      publisher: true,
      region: true,
      topic: true,
      summary: true,
      canonicalUrl: true,
      reviewedAt: true,
    },
  });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Resource library</h1>
      <p className="text-text-secondary mt-2 max-w-2xl">
        Every source NorthStar is allowed to cite. Retrieval draws only from this list, and only
        from entries a person has reviewed and published.
      </p>

      {sources.length === 0 ? (
        <EmptyState
          className="mt-8"
          title="No published sources yet"
          description="An administrator has not published any sources. Until they do, generated insights will be labelled exploratory because nothing can be cited."
          action={<ButtonLink href="/app">Back to dashboard</ButtonLink>}
        />
      ) : (
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {sources.map((source) => (
            <li key={source.id} className="border-border bg-surface rounded-card border p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="teal">{TOPIC_COPY[source.topic as Topic]}</Badge>
                <Badge>{source.region}</Badge>
              </div>

              <h2 className="mt-3 text-base font-semibold">
                <a
                  href={source.canonicalUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="hover:text-brand-teal hover:underline"
                >
                  {source.title}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </h2>

              <p className="text-text-secondary mt-1 text-sm">{source.publisher}</p>
              {source.summary ? (
                <p className="text-text-secondary mt-3 text-sm">{source.summary}</p>
              ) : null}
              {source.reviewedAt ? (
                <p className="text-text-secondary mt-4 text-xs">
                  Last reviewed{" "}
                  {source.reviewedAt.toLocaleDateString("en-CA", {
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
