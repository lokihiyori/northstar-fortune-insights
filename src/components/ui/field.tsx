import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A labelled input that wires its own error and hint text through
 * `aria-describedby`, so a validation message is announced rather than only
 * shown. Errors are never signalled by colour alone.
 */
export function Field({
  id,
  label,
  hint,
  errors,
  className,
  ...inputProps
}: {
  id: string;
  label: string;
  // `| undefined` is explicit because `exactOptionalPropertyTypes` is on: a
  // caller passing `errors={maybeUndefined}` is valid and common here.
  hint?: ReactNode | undefined;
  errors?: string[] | undefined;
  className?: string | undefined;
} & InputHTMLAttributes<HTMLInputElement>) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors && errors.length > 0 ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const invalid = Boolean(errorId);

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>

      {hint ? (
        <p id={hintId} className="text-text-secondary mt-1 text-sm">
          {hint}
        </p>
      ) : null}

      <input
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(
          "rounded-control bg-surface mt-1.5 h-11 w-full border px-3.5 text-base sm:text-sm",
          "placeholder:text-text-secondary",
          invalid ? "border-danger" : "border-border",
        )}
        {...inputProps}
      />

      {errorId ? (
        <ul id={errorId} className="mt-1.5 space-y-1">
          {errors?.map((error) => (
            <li key={error} className="text-danger flex gap-1.5 text-sm">
              <span aria-hidden="true">&#9888;</span>
              {error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Page- or form-level error summary, announced when it appears. */
export function FormMessage({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="border-danger/30 bg-danger/10 rounded-control border px-4 py-3">
      <p className="text-danger text-sm">{children}</p>
    </div>
  );
}
