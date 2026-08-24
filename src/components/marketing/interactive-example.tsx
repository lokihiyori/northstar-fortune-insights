"use client";

import { useState } from "react";
import { RecommendationMap } from "@/components/guidance/recommendation-map";
import { cn } from "@/lib/cn";
import { SAMPLE_REPORTS } from "@/features/guidance/sample-data";

/**
 * Spec section 5.1: visitors can switch between fictional profiles and watch the
 * recommendation update. This deliberately makes no AI call — the data is static
 * and hand-written, which keeps the page instant and free to serve.
 */
export function InteractiveExample() {
  const [reportId, setReportId] = useState(SAMPLE_REPORTS[0]?.id ?? "");
  const report = SAMPLE_REPORTS.find((item) => item.id === reportId) ?? SAMPLE_REPORTS[0];
  if (!report) return null;

  return (
    <div className="mt-8">
      <fieldset>
        <legend className="text-sm font-medium">Choose an example situation</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {SAMPLE_REPORTS.map((item) => {
            const active = item.id === report.id;
            return (
              <label
                key={item.id}
                className={cn(
                  "rounded-control cursor-pointer border px-3.5 py-2 text-sm transition-colors duration-150",
                  "focus-within:outline-brand-teal focus-within:outline-2 focus-within:outline-offset-2",
                  active
                    ? "border-brand-teal bg-brand-teal/10 text-text-primary"
                    : "border-border text-text-secondary hover:bg-surface-raised",
                )}
              >
                <input
                  type="radio"
                  name="example-profile"
                  value={item.id}
                  checked={active}
                  onChange={() => {
                    setReportId(item.id);
                  }}
                  className="sr-only"
                />
                <span className="font-medium">{item.profile.name}</span>
                <span className="text-text-secondary ml-2">{item.profile.headline}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <aside className="lg:col-span-4">
          <div className="rounded-card border-border bg-surface-raised border p-5">
            <h3 className="text-sm font-semibold">What NorthStar was given</h3>
            <dl className="mt-4 space-y-4 text-sm">
              <div>
                <dt className="text-text-secondary">Location</dt>
                <dd className="mt-0.5">{report.profile.region}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Situation</dt>
                <dd className="mt-0.5">{report.profile.careerStage}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Priorities</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {report.profile.priorities.map((priority, index) => (
                    <span
                      key={priority}
                      className="border-border bg-surface rounded-full border px-2 py-0.5 text-xs"
                    >
                      {index + 1}. {priority}
                    </span>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-text-secondary">Constraints</dt>
                <dd className="mt-1">
                  <ul className="space-y-1">
                    {report.profile.constraints.map((constraint) => (
                      <li key={constraint.id} className="flex gap-2">
                        <span
                          aria-hidden="true"
                          className="bg-brand-teal mt-2 size-1 shrink-0 rounded-full"
                        />
                        {constraint.label}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
          </div>
        </aside>

        {/*
         * `min-w-0` is load-bearing, not tidying.
         *
         * A grid item defaults to `min-width: auto`, so its minimum size is its
         * content's min-content. The map's tablist is three cards with a 15rem
         * readable minimum, giving 744px, and that escaped the tablist's own
         * `overflow-x-auto` through this item: the single mobile column resolved
         * to 786px inside a 350px grid, the aside stretched to match, and the
         * document scrolled sideways by 416px at 390 and 486px at 320.
         *
         * Opting out of the automatic minimum lets the column take the space
         * actually available, so the tablist finally scrolls inside its own box
         * — which is what it was always styled to do.
         */}
        <div className="min-w-0 lg:col-span-8">
          <RecommendationMap report={report} />
        </div>
      </div>
    </div>
  );
}
