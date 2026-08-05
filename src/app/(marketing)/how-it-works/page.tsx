import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The rules layer, curated retrieval, structured AI output, and validation behind every NorthStar recommendation.",
};

const PIPELINE = [
  {
    name: "Your input is normalized and checked",
    body: "Your question, profile, ranked priorities, and constraints are validated before anything else runs. Oversized or unsupported input is rejected here rather than quietly truncated.",
  },
  {
    name: "Deterministic rules run first",
    body: "Ordinary code — not a model — checks whether a recommendation would violate a budget, a timeframe, a work-authorization requirement, or a location constraint. Each rule has an identifier and its own test cases, so its behaviour is reproducible.",
  },
  {
    name: "Only reviewed sources are retrieved",
    body: "Retrieval is restricted to sources a human has read and marked Published, filtered to your topic and region. A retired source stays attached to reports that already cited it, but never enters a new one.",
  },
  {
    name: "The model receives a bounded evidence packet",
    body: "The retrieved passages are passed as evidence with stable source identifiers. They are treated strictly as data — instructions found inside a retrieved document are never followed.",
  },
  {
    name: "Output is validated before you see it",
    body: "The response must conform to a strict schema, and every citation identifier is checked against the evidence actually retrieved. A response citing something that was not retrieved is rejected, not repaired.",
  },
  {
    name: "The report is stored with its inputs",
    body: "Each version keeps a snapshot of what it was given, so you can compare versions later and see exactly what changed.",
  },
] as const;

const HONESTY = [
  {
    question: "Why three paths instead of one answer?",
    answer:
      "A single confident answer hides the trade-off you are actually deciding about. Three meaningfully different paths make the trade-off visible: what you gain, what you give up, and what would have to be true for each to be right.",
  },
  {
    question: "Why not a percentage match score?",
    answer:
      "A number like 87% implies a precision that does not exist for a subjective life decision. NorthStar uses Strong, Moderate, or Exploratory, and always shows the reasons behind the label.",
  },
  {
    question: "What happens when the evidence is thin?",
    answer:
      "The report says so. A path with no supporting published source is marked exploratory and presented as such. NorthStar will not manufacture a citation to look more certain.",
  },
  {
    question: "What will NorthStar not answer?",
    answer:
      "High-stakes medical, legal, immigration, financial, and mental-health questions receive a clear boundary and links to appropriate official resources instead of a personalized directive.",
  },
] as const;

export default function HowItWorksPage() {
  return (
    <>
      <Section className="aurora-glow pb-10">
        <Container>
          <SectionHeading
            eyebrow="How it works"
            title="Most of NorthStar is not the AI part"
            description="The interesting engineering is in what surrounds the model: what it is allowed to see, what it is required to produce, and what happens when it produces something wrong."
          />
        </Container>
      </Section>

      <Section aria-labelledby="pipeline-heading" className="border-border border-t pt-12">
        <Container>
          <h2 id="pipeline-heading" className="text-xl font-semibold tracking-tight">
            What happens when you ask a question
          </h2>

          <ol className="mt-8 space-y-4">
            {PIPELINE.map((step, index) => (
              <li key={step.name} className="rounded-card border-border bg-surface border p-6">
                <div className="flex gap-4">
                  <span className="border-brand-teal/40 text-brand-teal flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-base font-semibold">{step.name}</h3>
                    <p className="text-text-secondary mt-2 text-sm">{step.body}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      <Section aria-labelledby="honesty-heading" className="border-border bg-surface border-t">
        <Container>
          <h2 id="honesty-heading" className="text-xl font-semibold tracking-tight">
            The design decisions people ask about
          </h2>

          <dl className="mt-8 grid gap-6 md:grid-cols-2">
            {HONESTY.map((item) => (
              <div key={item.question} className="rounded-card border-border border p-6">
                <dt className="text-base font-semibold">{item.question}</dt>
                <dd className="text-text-secondary mt-2 text-sm">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </Section>

      <Section className="border-border border-t">
        <Container className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight">See it on a real question</h2>
          <p className="text-text-secondary mx-auto mt-3 max-w-xl">
            The examples are complete reports, not screenshots — evidence, assumptions, trade-offs,
            and all.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/examples" size="lg">
              View sample insights
            </ButtonLink>
            <ButtonLink href="/sign-up" variant="secondary" size="lg">
              Ask your own question
            </ButtonLink>
          </div>
        </Container>
      </Section>
    </>
  );
}
