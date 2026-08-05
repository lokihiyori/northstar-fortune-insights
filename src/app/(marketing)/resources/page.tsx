import type { Metadata } from "next";
import { ResourceBrowser } from "@/components/marketing/resource-browser";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

export const metadata: Metadata = {
  title: "Resources",
  description:
    "The curated, human-reviewed public sources NorthStar draws on for Canadian career, education, and relocation guidance.",
};

export default function ResourcesPage() {
  return (
    <>
      <Section className="aurora-glow pb-10">
        <Container>
          <SectionHeading
            eyebrow="Resource library"
            title="Every source we cite, in the open"
            description="NorthStar retrieves only from sources a person has read and published. This is that library — you can check it before you trust anything the product tells you."
          />
        </Container>
      </Section>

      <Section aria-labelledby="library-heading" className="border-border border-t pt-12">
        <Container>
          <h2 id="library-heading" className="sr-only">
            Browse resources
          </h2>
          <ResourceBrowser />
        </Container>
      </Section>

      <Section className="border-border bg-surface border-t">
        <Container>
          <SectionHeading
            title="How a source gets in"
            description="A source moves through Draft, Reviewed, Published, and eventually Retired. Only Published sources can be retrieved into a new report. Retiring a source leaves existing reports intact — a report should always show the evidence it was actually built on, not a later revision of it."
          />
        </Container>
      </Section>
    </>
  );
}
