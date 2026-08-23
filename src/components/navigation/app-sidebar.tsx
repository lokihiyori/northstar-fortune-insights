"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export const APP_NAV = [
  { href: "/app", label: "Dashboard", exact: true },
  { href: "/app/ask", label: "Ask" },
  { href: "/app/history", label: "History" },
  { href: "/app/resources", label: "Resources" },
  { href: "/app/profile", label: "Compass" },
  { href: "/app/billing", label: "Plan" },
] as const;

/**
 * The bottom bar has room for four destinations plus a disclosure. The split is
 * derived from `APP_NAV` rather than written out again, so a destination added
 * to the sidebar can never go missing on mobile — which is exactly what
 * happened when this file rendered `APP_NAV.slice(0, 4)` and nothing else:
 * Compass and Plan had no mobile entry, and the sidebar that carries them is
 * `hidden md:block`, so a phone had no route to either page at all.
 */
const PRIMARY_MOBILE_NAV = APP_NAV.slice(0, 4);
const SECONDARY_MOBILE_NAV = APP_NAV.slice(4);

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
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);

  // True when the current route lives behind the disclosure, so the control
  // still reports where the user is rather than hiding it.
  const secondaryActive = SECONDARY_MOBILE_NAV.some((item) =>
    isActive(pathname, item.href, "exact" in item ? item.exact : false),
  );

  /*
   * Escape closes and returns focus to the control that opened it. Without the
   * focus move a keyboard user is left on a node that has just been removed
   * from the document, and the browser drops focus to <body>.
   */
  useEffect(() => {
    if (!moreOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  // Closed in the link handler rather than in an effect on `pathname`, so it is
  // a direct consequence of the activation and not a render-triggered update.
  const closeMore = () => {
    setMoreOpen(false);
  };

  return (
    <nav
      aria-label="Application"
      className="border-border bg-surface sticky bottom-0 z-40 border-t md:hidden"
    >
      {/*
       * Dismisses on an outside tap. `aria-hidden` with no accessible name and
       * no tab stop: Escape is the keyboard route out, so this would only be a
       * duplicate control in the tab order.
       */}
      {moreOpen ? (
        <div
          aria-hidden="true"
          onClick={closeMore}
          className="fixed inset-0 cursor-default bg-transparent"
        />
      ) : null}

      {moreOpen ? (
        <div
          id="app-nav-more"
          className="border-border bg-surface absolute right-0 bottom-full left-0 border-t"
        >
          <ul className="p-2">
            {SECONDARY_MOBILE_NAV.map((item) => {
              const active = isActive(pathname, item.href, "exact" in item ? item.exact : false);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={closeMore}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-control flex min-h-11 items-center px-4 text-sm",
                      active
                        ? "bg-brand-teal/10 text-text-primary font-medium"
                        : "text-text-secondary",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* `relative` so the bar paints above the dismiss layer and stays tappable. */}
      <ul className="relative flex">
        {PRIMARY_MOBILE_NAV.map((item) => {
          const active = isActive(pathname, item.href, "exact" in item ? item.exact : false);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                onClick={closeMore}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center justify-center px-2 py-3 text-center text-xs",
                  active ? "text-brand-teal font-medium" : "text-text-secondary",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}

        <li className="flex-1">
          <button
            ref={moreButtonRef}
            type="button"
            aria-expanded={moreOpen}
            aria-controls="app-nav-more"
            onClick={() => {
              setMoreOpen((open) => !open);
            }}
            className={cn(
              "flex min-h-11 w-full items-center justify-center px-2 py-3 text-center text-xs",
              secondaryActive ? "text-brand-teal font-medium" : "text-text-secondary",
            )}
          >
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
