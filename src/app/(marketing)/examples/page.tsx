import type { Metadata } from "next";
import { InteractiveExample } from "@/components/marketing/interactive-example";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { SAMPLE_REPORTS } from "@/features/guidance/sample-data";
import { CONFIDENCE_COPY, TOPIC_COPY } from "@/features/guidance/types";

export const metadata: Metadata = {
  title: "Examples",
  description:
    "Complete sample guidance reports for three fictional people — with evidence, assumptions, trade-offs, and next actions.",
};

export default function ExamplesPage() {
  return (
    <>
      <Section className="aurora-glow pb-10">
        <Container>
          <SectionHeading
            eyebrow="Examples"
            title="Complete reports, not screenshots"
            description="Every person below is fictional, and every report is hand-written rather than generated. They exist to show the shape of the output before you sign up."
          />
        </Container>
      </Section>

      <Section aria-labelledby="explore-heading" className="border-border border-t pt-12">
        <Container>
          <h2 id="explore-heading" className="text-xl font-semibold tracking-tight">
            Explore a full report
          </h2>
          <InteractiveExample />
        </Container>
      </Section>

      <Section aria-labelledby="summary-heading" className="border-border bg-surface border-t">
        <Container>
          <h2 id="summary-heading" className="text-xl font-semibold tracking-tight">
            What each example covers
          </h2>

          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            {SAMPLE_REPORTS.map((report) => (
              <article
                key={report.id}
                className="rounded-card border-border bg-background border p-6"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="teal">{TOPIC_COPY[report.topic]}</Badge>
                  <Badge tone={report.confidenceBasis === "HIGH_EVIDENCE" ? "success" : "warning"}>
                    {CONFIDENCE_COPY[report.confidenceBasis]}
                  </Badge>
                </div>

                <h3 className="mt-4 text-base font-semibold">{report.profile.name}</h3>
                <p className="text-text-secondary mt-1 text-sm">{report.profile.headline}</p>

                <p className="border-border text-text-secondary mt-4 border-l-2 pl-3 text-sm italic">
                  {report.question}
                </p>

                <p className="mt-4 text-sm">{report.summary}</p>

                <div className="border-border mt-5 border-t pt-4">
                  <h4 className="text-text-secondary text-xs font-medium tracking-wide uppercase">
                    What NorthStar still does not know
                  </h4>
                  <ul className="text-text-secondary mt-2 space-y-1.5 text-sm">
                    {report.missingInformation.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span
                          aria-hidden="true"
                          className="bg-warning mt-2 size-1 shrink-0 rounded-full"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="border-border border-t">
        <Container className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight">
            Your situation is not on this list
          </h2>
          <p className="text-text-secondary mx-auto mt-3 max-w-xl">
            That is rather the point. Ask about the decision you are actually facing.
          </p>
          <ButtonLink href="/sign-up" size="lg" className="mt-8">
            Start with your own question
          </ButtonLink>
        </Container>
      </Section>
    </>
  );
}
