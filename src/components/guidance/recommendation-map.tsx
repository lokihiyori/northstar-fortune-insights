"use client";

import { useId, useRef, useState } from "react";
import { FitIndicator } from "@/components/guidance/fit-indicator";
import { PathDetail } from "@/components/guidance/path-detail";
import { cn } from "@/lib/cn";
import { PATH_LABEL_COPY, type SampleReport } from "@/features/guidance/types";

/**
 * The signature element from spec section 2.
 *
 * Built as a tablist rather than a clickable diagram: the three paths are the
 * real controls, so the component is fully operable by keyboard and reads as a
 * list to a screen reader. The constellation lines behind it are decorative and
 * marked `aria-hidden`, which is what satisfies the "equivalent list
 * representation" requirement in spec section 15 — the list *is* the primary
 * representation, and the drawing is the enhancement.
 *
 * On mobile the same tablist collapses to a horizontally scrolling segmented
 * control, so no separate carousel implementation is needed.
 */
export function RecommendationMap({ report }: { report: SampleReport }) {
  const baseId = useId();
  const [selectedId, setSelectedId] = useState(report.paths[0]?.id ?? "");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const selected = report.paths.find((path) => path.id === selectedId) ?? report.paths[0];
  if (!selected) return null;

  // Roving focus: arrow keys move between tabs, which is what the tablist
  // pattern requires — Tab alone should jump past the whole group.
  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();

    const next = report.paths[(index + delta + report.paths.length) % report.paths.length];
    if (!next) return;
    setSelectedId(next.id);
    tabRefs.current[next.id]?.focus();
  }

  return (
    <div className="rounded-card border-border bg-surface border">
      <div className="border-border relative border-b p-5 sm:p-6">
        <ConstellationLines />

        <div className="relative">
          <p className="text-text-secondary text-xs font-medium tracking-wide uppercase">
            Your goal
          </p>
          <p className="mt-1 max-w-xl text-sm font-medium">{report.question}</p>
        </div>

        <div
          role="tablist"
          aria-label="Recommended paths"
          className="relative -mx-1 mt-5 flex snap-x gap-3 overflow-x-auto px-1 pb-2 lg:grid lg:grid-cols-3 lg:overflow-visible"
        >
          {report.paths.map((path, index) => {
            const active = path.id === selected.id;
            return (
              <button
                key={path.id}
                ref={(node) => {
                  tabRefs.current[path.id] = node;
                }}
                role="tab"
                type="button"
                id={`${baseId}-tab-${path.id}`}
                aria-selected={active}
                aria-controls={`${baseId}-panel-${path.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => {
                  setSelectedId(path.id);
                }}
                onKeyDown={(event) => {
                  onKeyDown(event, index);
                }}
                className={cn(
                  "rounded-card min-w-[15rem] flex-1 snap-start border p-4 text-left",
                  "transition-colors duration-150",
                  active
                    ? "border-brand-teal bg-brand-teal/5"
                    : "border-border bg-surface hover:bg-surface-raised",
                )}
              >
                <span className="text-text-secondary text-xs font-medium">
                  {PATH_LABEL_COPY[path.label]}
                </span>
                <span className="mt-1.5 block text-sm font-semibold">{path.title}</span>
                <span className="mt-3 flex flex-wrap items-center gap-2">
                  <FitIndicator fit={path.fit} />
                </span>
                <span className="text-text-secondary mt-2 block text-xs">
                  Main trade-off: {path.mainTradeoff}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {report.paths.map((path) => (
        <div
          key={path.id}
          role="tabpanel"
          id={`${baseId}-panel-${path.id}`}
          aria-labelledby={`${baseId}-tab-${path.id}`}
          hidden={path.id !== selected.id}
          tabIndex={0}
          className="p-5 sm:p-6"
        >
          {path.id === selected.id ? <PathDetail path={path} /> : null}
        </div>
      ))}
    </div>
  );
}

/** Decorative only — see the component note above. */
function ConstellationLines() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-45"
      viewBox="0 0 600 220"
      preserveAspectRatio="none"
      focusable="false"
    >
      <g stroke="var(--color-brand-teal)" strokeWidth="1" fill="none" opacity="0.5">
        <path d="M300 42 L120 150" className="ns-constellation" />
        <path d="M300 42 L300 150" className="ns-constellation" />
        <path d="M300 42 L480 150" className="ns-constellation" />
      </g>
      <g fill="var(--color-brand-gold)">
        <circle cx="300" cy="42" r="3" />
      </g>
      <g fill="var(--color-brand-teal)">
        <circle cx="120" cy="150" r="2" />
        <circle cx="300" cy="150" r="2" />
        <circle cx="480" cy="150" r="2" />
      </g>
    </svg>
  );
}
