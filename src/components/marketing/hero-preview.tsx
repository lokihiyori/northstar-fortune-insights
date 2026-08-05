import { FitIndicator } from "@/components/guidance/fit-indicator";
import { Badge } from "@/components/ui/badge";
import { DEFAULT_SAMPLE_REPORT } from "@/features/guidance/sample-data";
import { PATH_LABEL_COPY } from "@/features/guidance/types";

/**
 * The hero's report preview (spec section 5.1). Static and server-rendered — a
 * marketing page should never pay for an AI call.
 */
export function HeroPreview() {
  const report = DEFAULT_SAMPLE_REPORT;
  const primary = report.paths[0];
  if (!primary) return null;

  const evidenceCount = report.paths.reduce((total, path) => total + path.evidence.length, 0);
  const firstAction = primary.nextActions[0];

  return (
    <div className="rounded-card border-border bg-surface shadow-card border p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <Badge tone="teal">{PATH_LABEL_COPY[primary.label]}</Badge>
        <span className="text-text-secondary text-xs">
          {evidenceCount} cited {evidenceCount === 1 ? "source" : "sources"}
        </span>
      </div>

      <h2 className="mt-4 text-lg font-semibold tracking-tight">{primary.title}</h2>

      <div className="mt-3 flex flex-wrap gap-2">
        <FitIndicator fit={primary.fit} />
        <Badge>{primary.timeHorizon}</Badge>
      </div>

      <ul className="text-text-secondary mt-5 space-y-2 text-sm">
        {primary.rationale.slice(0, 2).map((reason) => (
          <li key={reason} className="flex gap-2">
            <span aria-hidden="true" className="bg-brand-teal mt-2 size-1 shrink-0 rounded-full" />
            <span>{reason}</span>
          </li>
        ))}
      </ul>

      <div className="rounded-control border-border bg-surface-raised mt-5 border p-3">
        <p className="text-text-secondary text-xs font-medium tracking-wide uppercase">
          Main trade-off
        </p>
        <p className="mt-1 text-sm">{primary.mainTradeoff}</p>
      </div>

      {firstAction ? (
        <div className="border-border mt-4 border-t pt-4">
          <p className="text-text-secondary text-xs font-medium tracking-wide uppercase">
            First action
          </p>
          <p className="mt-1 text-sm font-medium">{firstAction.title}</p>
          <p className="text-text-secondary mt-0.5 text-sm">
            Suggested within {firstAction.targetDays} days
          </p>
        </div>
      ) : null}
    </div>
  );
}
