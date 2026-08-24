import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top edge owner for this shell. The border-b keeps painting edge to edge. */}
      <header className="border-border pt-safe-area border-b">
        <Container className="flex h-16 items-center justify-between">
          <Logo />
          <ThemeToggle />
        </Container>
      </header>

      <main
        id="main"
        tabIndex={-1}
        // Bottom edge owner: this shell has no footer.
        className="aurora-glow pb-safe-area flex flex-1 items-center pt-12 [--ns-pad-bottom:3rem] focus-visible:outline-none"
      >
        <Container className="max-w-md">{children}</Container>
      </main>
    </div>
  );
}
