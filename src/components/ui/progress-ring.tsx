import { cn } from "@/lib/cn";

/**
 * Circular progress. The numeric value is always rendered as text alongside it,
 * so the ring is decoration rather than the only carrier of meaning.
 */
export function ProgressRing({
  percent,
  label,
  size = 72,
  className,
}: {
  percent: number;
  label: string;
  size?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <svg
        width={size}
        height={size}
        role="img"
        aria-label={`${label}: ${String(clamped)}% complete`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface-raised"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-brand-teal transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div>
        <p className="font-display text-xl font-semibold">{clamped}%</p>
        <p className="text-text-secondary text-xs">{label}</p>
      </div>
    </div>
  );
}
