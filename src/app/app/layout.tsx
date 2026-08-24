import type { ReactNode } from "react";
import { AppSidebar, MobileBottomNav } from "@/components/navigation/app-sidebar";
import { DemoBadge, DemoBanner } from "@/components/demo/demo-banner";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/features/auth/actions";
import { requireUser } from "@/features/auth/guards";
import { isDemoSession } from "@/features/demo/session";

/**
 * The guard runs here rather than only in middleware. Middleware can be
 * bypassed by configuration mistakes and cannot read the database; this
 * redirect is the boundary that actually holds.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser("/app");
  // Server-derived. There is no client flag and no demo claim in the token.
  const isDemo = isDemoSession(user);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="focus:rounded-control focus:bg-surface focus:shadow-card focus:skip-link-inset sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      {/* Top edge owner for this shell. */}
      <header className="border-border bg-surface pt-safe-area border-b">
        <div className="px-safe-area flex h-16 items-center justify-between gap-4 [--ns-gutter:1.25rem] sm:[--ns-gutter:2rem]">
          <Logo href="/app" />
          <div className="flex items-center gap-3">
            {isDemo ? <DemoBadge /> : null}
            <span className="text-text-secondary hidden text-sm sm:inline">
              {user.name ?? user.email}
            </span>
            <ThemeToggle />
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      {isDemo ? <DemoBanner /> : null}

      <div className="flex flex-1">
        <AppSidebar />
        <main
          id="main"
          tabIndex={-1}
          className="px-safe-area md:pb-safe-area min-w-0 flex-1 py-8 [--ns-gutter:1.25rem] [--ns-pad-bottom:2rem] focus-visible:outline-none sm:[--ns-gutter:2rem]"
        >
          {children}
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
}
