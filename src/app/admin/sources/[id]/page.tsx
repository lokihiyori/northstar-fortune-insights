import { notFound } from "next/navigation";
import { IngestForm } from "@/components/admin/ingest-form";
import { SourceForm } from "@/components/admin/source-form";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { listAuditLogsForEntity } from "@/features/audit/log";
import { requireAdmin } from "@/features/auth/guards";
import { transitionSourceAction } from "@/features/sources/actions";
import { chunkStats } from "@/features/sources/ingest";
import { STATUS_COPY, STATUS_DESCRIPTION, TRANSITIONS } from "@/features/sources/lifecycle";
import { getSourceForAdmin } from "@/features/sources/queries";
import { TOPIC_COPY, type Topic } from "@/features/guidance/types";
import type { SourceStatus } from "@/generated/prisma/enums";

export const metadata = { title: "Source" };

const TONE: Record<SourceStatus, "neutral" | "teal" | "success" | "warning"> = {
  DRAFT: "neutral",
  REVIEWED: "teal",
  PUBLISHED: "success",
  RETIRED: "warning",
};

const ACTION_LABEL: Record<SourceStatus, string> = {
  DRAFT: "Return to draft",
  REVIEWED: "Mark reviewed",
  PUBLISHED: "Publish",
  RETIRED: "Retire",
};

export default async function AdminSourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin("/admin/sources");
  const { id } = await params;

  const source = await getSourceForAdmin(id);
  if (!source) notFound();

  const [stats, audit, query] = await Promise.all([
    chunkStats(source.id),
    listAuditLogsForEntity("Source", source.id),
    searchParams,
  ]);

  const rawError = query["error"];
  const error = Array.isArray(rawError) ? rawError[0] : rawError;
  const nextStates = TRANSITIONS[source.status];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[source.status]}>{STATUS_COPY[source.status]}</Badge>
            <Badge>{TOPIC_COPY[source.topic as Topic]}</Badge>
            <Badge>{source.region}</Badge>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{source.title}</h1>
          <p className="text-text-secondary mt-1 text-sm">{STATUS_DESCRIPTION[source.status]}</p>
        </div>
        <ButtonLink href="/admin/sources" variant="secondary" size="sm">
          All sources
        </ButtonLink>
      </div>

      {error ? (
        <div className="mt-6">
          <ErrorState title="That change was refused" description={error} />
        </div>
      ) : null}

      <section aria-labelledby="lifecycle-heading" className="mt-8">
        <h2 id="lifecycle-heading" className="text-lg font-semibold tracking-tight">
          Lifecycle
        </h2>
        <p className="text-text-secondary mt-2 text-sm">
          {stats.embedded} of {stats.total} passages embedded
          {source._count.citations > 0
            ? ` · cited by ${String(source._count.citations)} report path(s)`
            : ""}
          .
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          {nextStates.map((next) => (
            <form key={next} action={transitionSourceAction}>
              <input type="hidden" name="sourceId" value={source.id} />
              <input type="hidden" name="to" value={next} />
              <Button
                type="submit"
                variant={
                  next === "PUBLISHED" ? "primary" : next === "RETIRED" ? "danger" : "secondary"
                }
              >
                {ACTION_LABEL[next]}
              </Button>
            </form>
          ))}
        </div>

        {source.status === "PUBLISHED" ? (
          <p className="text-text-secondary mt-4 text-sm">
            Retiring removes this from future retrieval. Reports that already cite it keep their
            evidence — historical snapshots are never rewritten.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="metadata-heading" className="border-border mt-12 border-t pt-8">
        <h2 id="metadata-heading" className="text-lg font-semibold tracking-tight">
          Metadata
        </h2>
        <div className="mt-5">
          <SourceForm
            mode="edit"
            sourceId={source.id}
            initial={{
              title: source.title,
              publisher: source.publisher,
              region: source.region,
              topic: source.topic,
              canonicalUrl: source.canonicalUrl,
              summary: source.summary ?? "",
            }}
          />
        </div>
      </section>

      <section aria-labelledby="content-heading" className="border-border mt-12 border-t pt-8">
        <h2 id="content-heading" className="text-lg font-semibold tracking-tight">
          Content
        </h2>

        {source.chunks.length > 0 ? (
          <ol className="mt-5 space-y-3">
            {source.chunks.map((chunk) => (
              <li key={chunk.id} className="border-border bg-surface rounded-control border p-4">
                <div className="text-text-secondary flex flex-wrap gap-3 text-xs">
                  <span>Passage {chunk.position + 1}</span>
                  <span className="font-mono">{chunk.checksum.slice(0, 12)}</span>
                  <span>{chunk.embeddingModel}</span>
                </div>
                <p className="mt-2 text-sm">{chunk.text}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-text-secondary mt-4 text-sm">
            No content ingested yet. A source cannot be published without passages.
          </p>
        )}

        <div className="border-border mt-8 border-t pt-6">
          <h3 className="text-sm font-semibold">Replace content</h3>
          <p className="text-text-secondary mt-1 mb-4 text-sm">
            Re-ingesting replaces all passages for this source.
          </p>
          <IngestForm sourceId={source.id} />
        </div>
      </section>

      <section aria-labelledby="audit-heading" className="border-border mt-12 border-t pt-8">
        <h2 id="audit-heading" className="text-lg font-semibold tracking-tight">
          Audit history
        </h2>
        <p className="text-text-secondary mt-2 text-sm">
          Permanent and append-only. These records cannot be edited or deleted from the application.
        </p>

        <ul className="mt-5 space-y-2">
          {audit.map((entry) => (
            <li
              key={entry.id}
              className="border-border bg-surface rounded-control flex flex-wrap items-center gap-3 border p-3 text-sm"
            >
              <Badge tone={entry.action === "SOURCE_RETIRED" ? "warning" : "teal"}>
                {entry.action.replace("SOURCE_", "").toLowerCase()}
              </Badge>
              <span className="text-text-secondary">{entry.actorEmail ?? "unknown actor"}</span>
              <span className="text-text-secondary ml-auto text-xs">
                {entry.createdAt.toLocaleString("en-CA", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
