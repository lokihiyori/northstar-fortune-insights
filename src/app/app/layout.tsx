import type { ReactNode } from "react";
import { AppSidebar, MobileBottomNav } from "@/components/navigation/app-sidebar";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/features/auth/actions";
import { requireUser } from "@/features/auth/guards";

/**
 * The guard runs here rather than only in middleware. Middleware can be
 * bypassed by configuration mistakes and cannot read the database; this
 * redirect is the boundary that actually holds.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser("/app");

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="focus:rounded-control focus:bg-surface focus:shadow-card sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <header className="border-border bg-surface border-b">
        <div className="flex h-16 items-center justify-between gap-4 px-5 sm:px-8">
          <Logo href="/app" />
          <div className="flex items-center gap-3">
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

      <div className="flex flex-1">
        <AppSidebar />
        <main id="main" className="min-w-0 flex-1 px-5 py-8 sm:px-8">
          {children}
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
}
