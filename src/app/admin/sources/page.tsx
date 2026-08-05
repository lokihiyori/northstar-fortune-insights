import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { requireAdmin } from "@/features/auth/guards";
import { listSourcesForAdmin } from "@/features/sources/queries";
import { STATUS_COPY } from "@/features/sources/lifecycle";
import { TOPIC_COPY, type Topic } from "@/features/guidance/types";
import type { SourceStatus } from "@/generated/prisma/enums";

export const metadata = { title: "Sources" };

const TONE: Record<SourceStatus, "neutral" | "teal" | "success" | "warning"> = {
  DRAFT: "neutral",
  REVIEWED: "teal",
  PUBLISHED: "success",
  RETIRED: "warning",
};

export default async function AdminSourcesPage() {
  await requireAdmin("/admin/sources");
  const sources = await listSourcesForAdmin();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sources</h1>
          <p className="text-text-secondary mt-2">
            Only published sources reach the guidance engine.
          </p>
        </div>
        <ButtonLink href="/admin/sources/new">Add source</ButtonLink>
      </div>

      {sources.length === 0 ? (
        <EmptyState
          className="mt-8"
          title="No sources yet"
          description="Until at least one source is published, every generated report will be labelled exploratory because nothing can be cited."
          action={<ButtonLink href="/admin/sources/new">Add the first source</ButtonLink>}
        />
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
            <caption className="sr-only">All sources with lifecycle status</caption>
            <thead>
              <tr className="text-text-secondary">
                <th scope="col" className="border-border border-b p-3 font-medium">
                  Title
                </th>
                <th scope="col" className="border-border border-b p-3 font-medium">
                  Status
                </th>
                <th scope="col" className="border-border border-b p-3 font-medium">
                  Topic
                </th>
                <th scope="col" className="border-border border-b p-3 font-medium">
                  Region
                </th>
                <th scope="col" className="border-border border-b p-3 font-medium">
                  Passages
                </th>
                <th scope="col" className="border-border border-b p-3 font-medium">
                  Cited by
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.id}>
                  <td className="border-border border-b p-3">
                    <Link
                      href={`/admin/sources/${source.id}`}
                      className="hover:text-brand-teal font-medium hover:underline"
                    >
                      {source.title}
                    </Link>
                    <span className="text-text-secondary mt-0.5 block text-xs">
                      {source.publisher}
                    </span>
                  </td>
                  <td className="border-border border-b p-3">
                    <Badge tone={TONE[source.status]}>{STATUS_COPY[source.status]}</Badge>
                  </td>
                  <td className="border-border text-text-secondary border-b p-3">
                    {TOPIC_COPY[source.topic as Topic]}
                  </td>
                  <td className="border-border text-text-secondary border-b p-3">
                    {source.region}
                  </td>
                  <td className="border-border text-text-secondary border-b p-3">
                    {source._count.chunks}
                  </td>
                  <td className="border-border text-text-secondary border-b p-3">
                    {source._count.citations}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
