import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme/theme-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "NorthStar Fortune Insights — AI guidance for clearer decisions",
    template: "%s · NorthStar",
  },
  description:
    "NorthStar combines structured reflection, trusted resources, and AI-assisted analysis to help people make clearer career and life decisions.",
  applicationName: "NorthStar Fortune Insights",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#07111f" },
  ],
};

// Typed explicitly rather than via Next's generated `LayoutProps`, so `pnpm
// typecheck` passes on a clean checkout without a build having run first.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes writes the theme class here before paint; without
    // suppressHydrationWarning React flags the server/client class mismatch.
    <html
      lang="en"
      suppressHydrationWarning
      // Tells Next the smooth scroll in globals.css is deliberate, so it does
      // not warn about route transitions animating.
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${manrope.variable}`}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
