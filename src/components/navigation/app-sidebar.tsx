"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export const APP_NAV = [
  { href: "/app", label: "Dashboard", exact: true },
  { href: "/app/ask", label: "Ask" },
  { href: "/app/history", label: "History" },
  { href: "/app/resources", label: "Resources" },
  { href: "/app/profile", label: "Compass" },
  { href: "/app/settings", label: "Settings" },
] as const;

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** Left navigation on desktop; the same list becomes bottom navigation on mobile. */
export function AppSidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Application"
      className="border-border bg-surface hidden w-56 shrink-0 border-r md:block"
    >
      <ul className="sticky top-0 space-y-1 p-4">
        {APP_NAV.map((item) => {
          const active = isActive(pathname, item.href, "exact" in item ? item.exact : false);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-control block px-3 py-2 text-sm transition-colors duration-150",
                  active
                    ? "bg-brand-teal/10 text-text-primary font-medium"
                    : "text-text-secondary hover:bg-surface-raised hover:text-text-primary",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const items = APP_NAV.slice(0, 4);

  return (
    <nav
      aria-label="Application"
      className="border-border bg-surface sticky bottom-0 z-40 border-t md:hidden"
    >
      <ul className="flex">
        {items.map((item) => {
          const active = isActive(pathname, item.href, "exact" in item ? item.exact : false);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block px-2 py-3 text-center text-xs",
                  active ? "text-brand-teal font-medium" : "text-text-secondary",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
