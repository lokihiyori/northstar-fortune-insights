import type { Metadata } from "next";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

export const metadata: Metadata = {
  title: "About and methodology",
  description:
    "What NorthStar is for, how it reaches a recommendation, and the limits it will not pretend it does not have.",
};

const LIMITS = [
  {
    title: "It does not predict your future",
    body: "Despite the name, nothing here is fortune-telling. NorthStar reasons about paths and trade-offs given what you have told it. It has no information about what will actually happen to you.",
  },
  {
    title: "It is only as current as its sources",
    body: "Every source shows a last-reviewed date. Requirements and wage data change; a report generated today reflects the library as it stood today, which is why reports are versioned rather than silently updated.",
  },
  {
    title: "It does not know what you did not tell it",
    body: "Family circumstances, health, and preferences you leave out cannot be weighed. The report names what is missing rather than filling the gap with an assumption.",
  },
  {
    title: "It is not a licensed professional",
    body: "Medical, legal, immigration, financial, and mental-health questions receive a boundary and a link to an appropriate official body, not a personalized directive.",
  },
  {
    title: "It can still be wrong",
    body: "Validation catches fabricated citations and malformed output. It cannot catch a recommendation that is well-formed, well-cited, and simply not right for you. That is why every path lists what would change it.",
  },
] as const;

export default function AboutPage() {
  return (
    <>
      <Section className="aurora-glow pb-10">
        <Container>
          <SectionHeading
            eyebrow="About"
            title="Making uncertainty visible and useful"
            description="NorthStar exists because the hard part of a career or life decision is rarely a shortage of advice. It is that the advice arrives without its reasoning attached."
          />
        </Container>
      </Section>

      <Section aria-labelledby="mission-heading" className="border-border border-t pt-12">
        <Container className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <h2 id="mission-heading" className="text-xl font-semibold tracking-tight">
              What we are trying to do
            </h2>
          </div>
          <div className="space-y-5 lg:col-span-8">
            <p className="text-text-secondary">
              A confident answer is easy to produce and hard to evaluate. NorthStar is built on the
              opposite bet: that people making a real decision would rather see three defensible
              options with their assumptions exposed than one fluent recommendation they cannot
              interrogate.
            </p>
            <p className="text-text-secondary">
              That shapes everything. Fit is shown as Strong, Moderate, or Exploratory rather than a
              fabricated percentage. Confidence is never displayed without the reasons behind it.
              Every claim that could be checked against a source is checked against a source, and a
              recommendation that cannot be supported is labelled exploratory instead of dressed up.
            </p>
            <p className="text-text-secondary">
              The product is built for Canada and North America first, because eligibility rules,
              credential recognition, and labour data are all regional. Guidance that ignores where
              you are is not guidance.
            </p>
          </div>
        </Container>
      </Section>

      <Section aria-labelledby="limits-heading" className="border-border bg-surface border-t">
        <Container>
          <h2 id="limits-heading" className="text-xl font-semibold tracking-tight">
            What NorthStar cannot do
          </h2>
          <p className="text-text-secondary mt-3 max-w-2xl">
            A product that lists its limitations is easier to trust on the things it does claim.
          </p>

          <dl className="mt-8 grid gap-6 md:grid-cols-2">
            {LIMITS.map((limit) => (
              <div key={limit.title} className="rounded-card border-border border p-6">
                <dt className="text-base font-semibold">{limit.title}</dt>
                <dd className="text-text-secondary mt-2 text-sm">{limit.body}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </Section>

      <Section aria-labelledby="name-heading" className="border-border border-t">
        <Container>
          <SectionHeading
            id="name-heading"
            title="A note on the name"
            description="“Fortune Insights” is the company name, not a description of the product. We use words like guidance, path, scenario, signal, and next step — because that is what the software actually produces. If you ever see NorthStar promise a guaranteed outcome, that is a bug."
          />
        </Container>
      </Section>
    </>
  );
}
