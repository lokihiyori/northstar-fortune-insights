import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FitIndicator } from "@/components/guidance/fit-indicator";
import { ButtonLink } from "@/components/ui/button";
import { requireUser } from "@/features/auth/guards";
import { getReportForUser } from "@/features/guidance/queries";
import { PATH_LABEL_COPY } from "@/features/guidance/types";

export const metadata: Metadata = { title: "Compare paths" };

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/app/compare/${id}`);

  const report = await getReportForUser(id, user.id);
  if (!report) notFound();

  const rows = [
    { label: "Fit", render: (index: number) => <FitIndicator fit={report.paths[index]!.fit} /> },
    { label: "Time horizon", render: (index: number) => report.paths[index]!.timeHorizon },
    { label: "Main trade-off", render: (index: number) => report.paths[index]!.mainTradeoff },
    {
      label: "Evidence",
      render: (index: number) => {
        const count = report.paths[index]!.evidence.length;
        return count === 0 ? "No cited source" : `${String(count)} cited`;
      },
    },
    {
      label: "First action",
      render: (index: number) => report.paths[index]!.nextActions[0]?.title ?? "—",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Compare the paths</h1>
      <p className="text-text-secondary mt-2 max-w-2xl">
        The criteria below are shown raw, not rolled into a single score. A winner declared by
        formula would hide the trade-off you are actually deciding about.
      </p>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            Comparison of the recommended paths for: {report.question}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="border-border w-40 border-b p-3 font-medium">
                Criterion
              </th>
              {report.paths.map((path) => (
                <th key={path.id} scope="col" className="border-border border-b p-3 align-top">
                  <span className="text-text-secondary block text-xs font-normal">
                    {PATH_LABEL_COPY[path.label]}
                  </span>
                  <span className="mt-1 block font-semibold">{path.title}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="border-border border-b p-3 align-top font-medium">
                  {row.label}
                </th>
                {report.paths.map((path, index) => (
                  <td
                    key={path.id}
                    className="border-border text-text-secondary border-b p-3 align-top"
                  >
                    {row.render(index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section aria-labelledby="wtbt-heading" className="mt-10">
        <h2 id="wtbt-heading" className="text-lg font-semibold tracking-tight">
          What would need to be true?
        </h2>
        <p className="text-text-secondary mt-2 max-w-2xl text-sm">
          More useful than declaring a winner: each path is right only if its assumptions hold.
        </p>

        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          {report.paths.map((path) => (
            <div key={path.id} className="border-border bg-surface rounded-card border p-5">
              <h3 className="text-sm font-semibold">{path.title}</h3>
              <ul className="mt-3 space-y-2">
                {(path.assumptions.length > 0 ? path.assumptions : path.changeConditions).map(
                  (item) => (
                    <li key={item} className="text-text-secondary flex gap-2 text-sm">
                      <span
                        aria-hidden="true"
                        className="bg-brand-teal mt-2 size-1 shrink-0 rounded-full"
                      />
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-10">
        <ButtonLink href={`/app/insights/${report.id}`} variant="secondary">
          Back to the full insight
        </ButtonLink>
      </div>
    </div>
  );
}
