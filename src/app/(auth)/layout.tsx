import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border border-b">
        <Container className="flex h-16 items-center justify-between">
          <Logo />
          <ThemeToggle />
        </Container>
      </header>

      <main id="main" className="aurora-glow flex flex-1 items-center py-12">
        <Container className="max-w-md">{children}</Container>
      </main>
    </div>
  );
}
