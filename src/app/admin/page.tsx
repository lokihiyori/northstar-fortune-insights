import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { requireAdmin } from "@/features/auth/guards";
import { listRecentAuditLogs } from "@/features/audit/log";
import { sourceStatusCounts } from "@/features/sources/queries";
import { STATUS_COPY, STATUS_DESCRIPTION } from "@/features/sources/lifecycle";
import type { SourceStatus } from "@/generated/prisma/enums";

export const metadata = { title: "Admin overview" };

const ORDER: SourceStatus[] = ["DRAFT", "REVIEWED", "PUBLISHED", "RETIRED"];

export default async function AdminOverviewPage() {
  // Checked again here, not only in the layout: a page must not depend on a
  // parent having run a guard.
  await requireAdmin("/admin");

  const [counts, recent] = await Promise.all([sourceStatusCounts(), listRecentAuditLogs(12)]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
      <p className="text-text-secondary mt-2 max-w-2xl">
        Only <strong>published</strong> sources can be retrieved into a report. Everything else is
        invisible to the guidance engine.
      </p>

      <section aria-labelledby="corpus-heading" className="mt-8">
        <h2 id="corpus-heading" className="text-lg font-semibold tracking-tight">
          Source corpus
        </h2>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ORDER.map((status) => (
            <div key={status} className="border-border bg-surface rounded-card border p-5">
              <dt className="text-text-secondary text-xs font-medium tracking-wide uppercase">
                {STATUS_COPY[status]}
              </dt>
              <dd className="font-display mt-1 text-3xl font-semibold">{counts[status]}</dd>
              <dd className="text-text-secondary mt-2 text-xs">{STATUS_DESCRIPTION[status]}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6">
          <ButtonLink href="/admin/sources">Manage sources</ButtonLink>
        </div>
      </section>

      <section aria-labelledby="audit-heading" className="border-border mt-12 border-t pt-8">
        <h2 id="audit-heading" className="text-lg font-semibold tracking-tight">
          Recent activity
        </h2>
        <p className="text-text-secondary mt-2 text-sm">
          Every source change is recorded permanently. These records cannot be edited or deleted
          from the application.
        </p>

        {recent.length === 0 ? (
          <EmptyState
            className="mt-5"
            title="No activity yet"
            description="Source creations, reviews, publications, and retirements will appear here."
          />
        ) : (
          <ul className="mt-5 space-y-2">
            {recent.map((entry) => (
              <li
                key={entry.id}
                className="border-border bg-surface rounded-control flex flex-wrap items-center gap-3 border p-3 text-sm"
              >
                <Badge tone={entry.action === "SOURCE_RETIRED" ? "warning" : "teal"}>
                  {entry.action.replace("SOURCE_", "").toLowerCase()}
                </Badge>
                <span className="text-text-secondary">{entry.actorEmail ?? "unknown actor"}</span>
                <Link
                  href={`/admin/sources/${entry.entityId}`}
                  className="text-brand-teal font-medium hover:underline"
                >
                  {entry.entityType} {entry.entityId.slice(0, 8)}
                </Link>
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
        )}
      </section>
    </div>
  );
}
