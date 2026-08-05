"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // The colour change is the point; animating it just delays legibility.
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
