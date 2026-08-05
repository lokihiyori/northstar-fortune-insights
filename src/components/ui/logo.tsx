import Link from "next/link";
import { cn } from "@/lib/cn";

/** The four-point star is the one place gold is used at full strength. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={cn("size-6", className)}>
      <path
        d="M12 1.5 13.9 9 21.5 12 13.9 15 12 22.5 10.1 15 2.5 12 10.1 9Z"
        fill="var(--color-brand-gold)"
      />
      <circle cx="12" cy="12" r="1.6" fill="var(--color-brand-navy)" />
    </svg>
  );
}

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "font-display inline-flex items-center gap-2 text-base font-semibold",
        className,
      )}
    >
      <LogoMark />
      <span>
        NorthStar
        <span className="text-text-secondary ml-1 font-normal">Fortune Insights</span>
      </span>
    </Link>
  );
}
