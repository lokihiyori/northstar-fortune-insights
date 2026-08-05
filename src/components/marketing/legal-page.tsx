import type { ReactNode } from "react";
import { Container, Section } from "@/components/ui/container";

export function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <Section>
      <Container className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-text-secondary mt-2 text-sm">Last updated {lastUpdated}</p>

        <div className="rounded-control border-warning/30 bg-warning/10 mt-4 border p-4">
          <p className="text-warning text-sm">
            Draft for review. This document describes how the product is designed to behave. It has
            not been reviewed by legal counsel and is not yet a binding agreement.
          </p>
        </div>

        <div className="[&_li]:text-text-secondary [&_p]:text-text-secondary mt-10 space-y-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
          {children}
        </div>
      </Container>
    </Section>
  );
}
