import type { ReactNode } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Logo } from "@/components/ui/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { signOutAction } from "@/features/auth/actions";
import { requireAdmin } from "@/features/auth/guards";

export const metadata = { title: "Admin" };

/**
 * Server-side authorization for the whole admin area.
 *
 * `requireAdmin` re-reads the role from the database rather than trusting the
 * JWT claim (ADR 0006), so a stale token cannot grant access. This layout is a
 * boundary, not a convenience: every admin page below it is unreachable without
 * passing here, and each admin Route Handler checks independently as well —
 * neither relies on the navigation being hidden.
 */
const NAV = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/sources", label: "Sources" },
] as const;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin("/admin");

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#admin-main"
        className="focus:rounded-control focus:bg-surface focus:shadow-card sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <header className="border-border bg-surface border-b">
        <Container className="flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo href="/admin" />
            <Badge tone="gold">Admin</Badge>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-text-secondary hidden text-sm sm:inline">{admin.email}</span>
            <Link href="/app" className="text-text-secondary hover:text-text-primary text-sm">
              Back to app
            </Link>
            <ThemeToggle />
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </Container>
      </header>

      <div className="border-border bg-surface-raised border-b">
        <Container>
          <nav aria-label="Admin" className="flex gap-1 py-2">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-control text-text-secondary hover:bg-surface hover:text-text-primary px-3 py-2 text-sm"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </Container>
      </div>

      <main id="admin-main" className="flex-1 py-8">
        <Container>{children}</Container>
      </main>
    </div>
  );
}
