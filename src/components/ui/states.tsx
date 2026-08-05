import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Every view in the app needs empty, loading, and error states (CLAUDE.md).
 * They live together so the three read consistently rather than drifting apart.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border bg-surface rounded-card border border-dashed p-10 text-center",
        className,
      )}
    >
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="text-text-secondary mx-auto mt-2 max-w-md text-sm">{description}</div>
      {action ? <div className="mt-6 flex justify-center gap-3">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
}: {
  title?: string;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn("border-danger/30 bg-danger/5 rounded-card border p-8", className)}
    >
      <h3 className="text-danger text-base font-semibold">{title}</h3>
      <div className="text-text-secondary mt-2 max-w-md text-sm">{description}</div>
      {action ? <div className="mt-6 flex gap-3">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("bg-surface-raised animate-pulse rounded-md", className)}
    />
  );
}

/** Announced placeholder for a whole page while its data resolves. */
export function LoadingPanel({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}
