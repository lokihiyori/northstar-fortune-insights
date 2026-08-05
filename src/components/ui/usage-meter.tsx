import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Remaining monthly report allowance. Phase 6 feeds this from the usage ledger;
 * until then the caller supplies the numbers.
 */
export function UsageMeter({
  used,
  allowance,
  className,
}: {
  used: number;
  allowance: number;
  className?: string;
}) {
  const remaining = Math.max(0, allowance - used);
  const percent = allowance === 0 ? 0 : Math.min(100, Math.round((used / allowance) * 100));
  const exhausted = remaining === 0;

  return (
    <div className={cn("border-border bg-surface rounded-card border p-5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Monthly reports</h3>
        <p className="text-text-secondary text-sm">
          {remaining} of {allowance} left
        </p>
      </div>

      <div
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={allowance}
        aria-label="Reports used this month"
        className="bg-surface-raised mt-3 h-1.5 w-full overflow-hidden rounded-full"
      >
        <div
          className={cn("h-full rounded-full", exhausted ? "bg-warning" : "bg-brand-teal")}
          style={{ width: `${String(percent)}%` }}
        />
      </div>

      {exhausted ? (
        <p className="text-text-secondary mt-3 text-sm">
          You have used this month&rsquo;s reports.{" "}
          <Link href="/pricing" className="text-brand-teal font-medium hover:underline">
            See plans
          </Link>
        </p>
      ) : null}
    </div>
  );
}
