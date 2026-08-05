import type { CompassProfile } from "@/features/onboarding/queries";
import { CAREER_STAGES, PRIORITIES, TIMEFRAMES } from "@/features/onboarding/schema";

function labelFor(
  options: readonly { value: string; label: string }[],
  value: string | null,
): string | null {
  if (!value) return null;
  return options.find((option) => option.value === value)?.label ?? null;
}

/**
 * The live preview from spec section 4 — it fills in as the user completes the
 * form, so the value of answering is visible while answering.
 */
export function CompassPreview({
  profile,
  completion,
}: {
  profile: CompassProfile;
  completion: number;
}) {
  const rows = [
    { label: "Where you are", value: profile.region },
    { label: "Stage", value: labelFor(CAREER_STAGES, profile.careerStage) },
    { label: "Current role", value: profile.currentRole },
    { label: "Goal", value: profile.primaryGoal },
    { label: "Timeframe", value: labelFor(TIMEFRAMES, profile.timeframe) },
  ];

  return (
    <div className="border-border bg-surface rounded-card border p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Your compass</h2>
        <span className="text-text-secondary text-xs">{completion}% complete</span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={completion}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Compass completeness"
        className="bg-surface-raised mt-3 h-1.5 w-full overflow-hidden rounded-full"
      >
        <div
          className="bg-brand-teal h-full rounded-full transition-[width] duration-300"
          style={{ width: `${String(completion)}%` }}
        />
      </div>

      <dl className="mt-5 space-y-3 text-sm">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-text-secondary text-xs">{row.label}</dt>
            <dd className={row.value ? "mt-0.5" : "text-text-secondary mt-0.5 italic"}>
              {row.value ?? "Not set yet"}
            </dd>
          </div>
        ))}

        <div>
          <dt className="text-text-secondary text-xs">Priorities</dt>
          <dd className="mt-1">
            {profile.priorities.length === 0 ? (
              <span className="text-text-secondary italic">Not set yet</span>
            ) : (
              <ol className="flex flex-wrap gap-1.5">
                {profile.priorities.map((priority) => (
                  <li
                    key={priority.key}
                    className="border-border bg-background rounded-full border px-2 py-0.5 text-xs"
                  >
                    {priority.rank}. {labelFor(PRIORITIES, priority.key)}
                  </li>
                ))}
              </ol>
            )}
          </dd>
        </div>

        <div>
          <dt className="text-text-secondary text-xs">Constraints</dt>
          <dd className="mt-1">
            {profile.constraints.length === 0 ? (
              <span className="text-text-secondary italic">Not set yet</span>
            ) : (
              <ul className="space-y-1">
                {profile.constraints.map((constraint) => (
                  <li key={constraint.id} className="text-text-secondary flex gap-2">
                    <span
                      aria-hidden="true"
                      className="bg-brand-teal mt-2 size-1 shrink-0 rounded-full"
                    />
                    {constraint.value}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
