import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "teal" | "gold" | "success" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "border-border bg-surface-raised text-text-secondary",
  teal: "border-brand-teal/30 bg-brand-teal/10 text-brand-teal",
  gold: "border-brand-gold/35 bg-brand-gold/10 text-brand-gold",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
