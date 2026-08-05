import { FitIndicator } from "@/components/guidance/fit-indicator";
import { Badge } from "@/components/ui/badge";
import { PATH_LABEL_COPY, type RecommendationPath } from "@/features/guidance/types";

function DetailList({
  heading,
  items,
  ordered = false,
}: {
  heading: string;
  items: readonly string[];
  ordered?: boolean;
}) {
  if (items.length === 0) return null;
  const List = ordered ? "ol" : "ul";

  return (
    <div>
      <h4 className="text-sm font-semibold">{heading}</h4>
      <List className="text-text-secondary mt-2 space-y-1.5 text-sm">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true" className="bg-brand-teal mt-2 size-1 shrink-0 rounded-full" />
            <span>{item}</span>
          </li>
        ))}
      </List>
    </div>
  );
}

/** Spec section 5.5: the ordered anatomy of a selected path. */
export function PathDetail({ path }: { path: RecommendationPath }) {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="teal">{PATH_LABEL_COPY[path.label]}</Badge>
          <FitIndicator fit={path.fit} />
          <Badge>{path.timeHorizon}</Badge>
        </div>
        <h3 className="mt-3 text-xl font-semibold tracking-tight">{path.title}</h3>
      </div>

      <DetailList heading="Why it fits" items={path.rationale} />

      {path.evidence.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold">Evidence</h4>
          <ul className="mt-2 space-y-3">
            {path.evidence.map((item) => (
              <li key={item.sourceId} className="rounded-control border-border border p-3">
                <p className="text-text-secondary text-sm">{item.claim}</p>
                <p className="text-text-secondary mt-2 text-xs">
                  <span className="text-text-primary font-medium">{item.publisher}</span>
                  <span aria-hidden="true"> · </span>
                  {item.region}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-control border-warning/30 bg-warning/10 border p-3">
          <p className="text-warning text-sm">
            No published source directly supports this path, so it is presented as exploratory.
          </p>
        </div>
      )}

      <DetailList heading="Assumptions" items={path.assumptions} />
      <DetailList heading="Trade-offs and risks" items={path.tradeoffs} />
      <DetailList heading="What could change this recommendation" items={path.changeConditions} />

      <div>
        <h4 className="text-sm font-semibold">First actions</h4>
        <ol className="mt-2 space-y-3">
          {path.nextActions.map((action, index) => (
            <li key={action.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="border-brand-teal/40 text-brand-teal mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
              >
                {index + 1}
              </span>
              <div>
                <p className="text-sm font-medium">{action.title}</p>
                <p className="text-text-secondary mt-0.5 text-sm">{action.description}</p>
                <p className="text-text-secondary mt-1 text-xs">
                  Suggested within {action.targetDays} days
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
