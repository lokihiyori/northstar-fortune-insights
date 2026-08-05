import { Badge } from "@/components/ui/badge";
import { FIT_COPY, type Fit } from "@/features/guidance/types";

const TONE = {
  STRONG: "success",
  MODERATE: "teal",
  EXPLORATORY: "warning",
} as const;

// Three filled marks for STRONG, two for MODERATE, one for EXPLORATORY. The
// count is decorative — the word carries the meaning, so colour is never the
// only channel (spec section 15).
const FILLED = { STRONG: 3, MODERATE: 2, EXPLORATORY: 1 } as const;

export function FitIndicator({ fit }: { fit: Fit }) {
  return (
    <Badge tone={TONE[fit]}>
      <span aria-hidden="true" className="flex gap-0.5">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className={
              index < FILLED[fit]
                ? "size-1.5 rounded-full bg-current"
                : "size-1.5 rounded-full border border-current opacity-40"
            }
          />
        ))}
      </span>
      {FIT_COPY[fit]} fit
    </Badge>
  );
}
