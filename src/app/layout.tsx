import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "NorthStar Fortune Insights",
    template: "%s · NorthStar",
  },
  description: "AI guidance for clearer life and career decisions.",
};

// Typed explicitly rather than via Next's generated `LayoutProps`, so `pnpm
// typecheck` passes on a clean checkout without a build having run first.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900 antialiased">{children}</body>
    </html>
  );
}
