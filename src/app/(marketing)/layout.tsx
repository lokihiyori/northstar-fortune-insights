import type { ReactNode } from "react";
import { MarketingFooter } from "@/components/navigation/marketing-footer";
import { MarketingHeader } from "@/components/navigation/marketing-header";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="focus:rounded-control focus:bg-surface focus:shadow-card focus:skip-link-inset sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <MarketingHeader />
      <main id="main" tabIndex={-1} className="flex-1 focus-visible:outline-none">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
