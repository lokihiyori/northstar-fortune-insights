import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Spec section 2: marketing content maxes out at 1200–1280px. */
export function Container({
  as: Tag = "div",
  className,
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        "mx-auto w-full max-w-[1280px]",
        /*
         * The inline safe-area owner for the marketing, auth, and admin shells.
         *
         * `--ns-gutter` carries what `px-5 sm:px-8` used to say, and
         * `px-safe-area` takes the larger of it and the cutout. At a zero inset
         * the computed padding is 1.25rem / 2rem exactly as before.
         */
        "px-safe-area [--ns-gutter:1.25rem] sm:[--ns-gutter:2rem]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function Section({
  className,
  children,
  ...rest
}: {
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  return (
    <section className={cn("py-16 sm:py-24", className)} {...rest}>
      {children}
    </section>
  );
}
