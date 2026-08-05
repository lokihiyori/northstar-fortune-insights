import Link from "next/link";
import { Container } from "@/components/ui/container";
import { LogoMark } from "@/components/ui/logo";

const GROUPS = [
  {
    heading: "Product",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/examples", label: "Examples" },
      { href: "/resources", label: "Resources" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/about", label: "About and methodology" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
] as const;

export function MarketingFooter() {
  return (
    <footer className="border-border bg-surface border-t">
      <Container className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2">
            <LogoMark />
            <span className="font-display font-semibold">NorthStar Fortune Insights</span>
          </div>
          <p className="text-text-secondary mt-3 max-w-sm text-sm leading-relaxed">
            AI guidance for clearer life and career decisions. NorthStar is general educational
            decision support — it does not predict outcomes and does not replace licensed medical,
            legal, immigration, financial, or mental-health professionals.
          </p>
        </div>

        {GROUPS.map((group) => (
          <nav key={group.heading} aria-label={group.heading}>
            <h2 className="text-sm font-semibold">{group.heading}</h2>
            <ul className="mt-3 space-y-2">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-text-secondary hover:text-text-primary text-sm transition-colors duration-150"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>

      <Container className="border-border text-text-secondary flex flex-col gap-2 border-t py-6 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>&copy; {new Date().getFullYear()} NorthStar Fortune Insights. Built in Canada.</p>
        <p>Structured reasoning · Source-backed insights · You stay in control</p>
      </Container>
    </footer>
  );
}
