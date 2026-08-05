import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Spec section 2 prefers borders over shadows, so `raised` adjusts the surface
 * colour rather than adding elevation.
 */
export function Card({
  as: Tag = "div",
  raised = false,
  interactive = false,
  className,
  children,
  ...rest
}: {
  as?: ElementType;
  raised?: boolean;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  return (
    <Tag
      className={cn(
        "rounded-card border-border border p-6",
        raised ? "bg-surface-raised" : "bg-surface",
        interactive && "hover:bg-surface-raised transition-colors duration-150",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("text-base font-semibold", className)}>{children}</h3>;
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-text-secondary text-sm", className)}>{children}</p>;
}
