"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/cn";

const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/examples", label: "Examples" },
  { href: "/resources", label: "Resources" },
  { href: "/pricing", label: "Pricing" },
] as const;

export function MarketingHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Spec section 5.1: sticky only after the user scrolls past the hero.
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 80);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // A menu left open across a navigation would cover the new page. Closing it in
  // the link handler rather than in an effect on `pathname` keeps this a direct
  // consequence of the click instead of a render-triggered state update.
  const closeMenu = () => {
    setMenuOpen(false);
  };

  return (
    <header
      className={cn(
        "top-0 z-50 w-full border-b transition-colors duration-200",
        scrolled
          ? "border-border bg-background/85 sticky backdrop-blur-md"
          : "relative border-transparent",
      )}
    >
      <Container className="flex h-16 items-center justify-between gap-4">
        <Logo />

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-control px-3 py-2 text-sm transition-colors duration-150",
                  active
                    ? "text-text-primary font-medium"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-raised",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/sign-in"
            className="rounded-control text-text-secondary hover:text-text-primary hidden px-3 py-2 text-sm transition-colors duration-150 sm:inline-flex"
          >
            Sign in
          </Link>
          <ButtonLink href="/sign-up" size="sm" className="hidden sm:inline-flex">
            Find your next step
          </ButtonLink>

          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => {
              setMenuOpen((open) => !open);
            }}
            className="rounded-control border-border text-text-secondary inline-flex size-9 items-center justify-center border md:hidden"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              className="size-[18px]"
            >
              {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </Container>

      {menuOpen ? (
        <div id="mobile-nav" className="border-border bg-surface border-t md:hidden">
          <Container className="flex flex-col gap-1 py-4">
            <nav aria-label="Primary mobile" className="flex flex-col">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={closeMenu}
                  aria-current={pathname === link.href ? "page" : undefined}
                  className="rounded-control text-text-secondary hover:bg-surface-raised hover:text-text-primary px-3 py-3 text-sm"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="border-border mt-2 flex flex-col gap-2 border-t pt-4">
              <ButtonLink href="/sign-up" size="md" onClick={closeMenu}>
                Find your next step
              </ButtonLink>
              <ButtonLink href="/sign-in" variant="secondary" size="md" onClick={closeMenu}>
                Sign in
              </ButtonLink>
            </div>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
