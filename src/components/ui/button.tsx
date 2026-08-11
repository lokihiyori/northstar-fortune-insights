import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  // Spec section 2: the main CTA is teal, never gold.
  // `text-on-brand`, not `text-white`: the dark theme's teal is light, so white
  // on it measured 1.84:1. The paired token follows the teal into both themes.
  primary: "bg-brand-teal text-on-brand hover:brightness-110 active:brightness-95",
  secondary:
    "border border-border bg-surface text-text-primary hover:bg-surface-raised active:bg-surface-raised",
  ghost: "text-text-secondary hover:bg-surface-raised hover:text-text-primary",
  danger: "bg-danger text-white hover:brightness-110",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-5 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

const BASE = cn(
  "inline-flex items-center justify-center rounded-control font-medium",
  "transition-[background-color,color,filter,border-color] duration-150",
  "disabled:pointer-events-none disabled:opacity-55",
);

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props}>
      {children}
    </button>
  );
}

/**
 * A link styled as a button. Kept separate from `Button` so that navigation
 * always renders an anchor — a `<button>` with an onClick router push is not
 * reachable the same way by keyboard, middle-click, or a screen reader.
 */
export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  onClick,
  children,
}: CommonProps & { href: string; onClick?: (() => void) | undefined }) {
  return (
    <Link
      href={href}
      // Spread conditionally: `exactOptionalPropertyTypes` rejects an explicit
      // undefined for Link's onClick.
      {...(onClick ? { onClick } : {})}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
    >
      {children}
    </Link>
  );
}
