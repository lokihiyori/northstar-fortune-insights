import Link from "next/link";
import { HeroPreview } from "@/components/marketing/hero-preview";
import { InteractiveExample } from "@/components/marketing/interactive-example";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { PRICING_NOTE } from "@/features/billing/plans";

const DIFFERENTIATORS = [
  {
    title: "Understands context",
    body: "Your goals, location, constraints, and ranked priorities shape the analysis before anything is generated.",
  },
  {
    title: "Explains the reasoning",
    body: "Every path states its assumptions, its trade-offs, and what would have to change for the recommendation to change.",
  },
  {
    title: "Turns insight into action",
    body: "Choose a path and it becomes a plan with milestones, resources, and progress you can track.",
  },
] as const;

const STEPS = [
  {
    name: "Ask",
    body: "A guided composer helps you turn a vague worry into a decision question that can actually be answered.",
  },
  {
    name: "Structure",
    body: "Deterministic rules check your constraints, flag conflicts, and mark what information is missing.",
  },
  {
    name: "Explore",
    body: "Three genuinely different paths, each with evidence from reviewed sources and an honest confidence label.",
  },
  {
    name: "Act",
    body: "Save a path as a plan with 30, 60, and 90-day milestones, then revisit it when your situation changes.",
  },
] as const;

export default function LandingPage() {
  return (
    <>
      <Section className="aurora-glow pt-12 pb-16 sm:pt-16">
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <p className="text-brand-teal text-sm font-semibold">
                Clarity for the decisions that shape your path.
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
                Turn uncertainty into a path you can act on.
              </h1>
              <p className="text-text-secondary mt-5 max-w-xl text-lg leading-relaxed">
                NorthStar combines your goals, real-world constraints, and trusted resources to
                create explainable career and life guidance.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink href="/sign-up" size="lg">
                  Explore my options
                </ButtonLink>
                <ButtonLink href="/examples" variant="secondary" size="lg">
                  View a sample insight
                </ButtonLink>
              </div>

              <p className="text-text-secondary mt-6 text-sm">
                Structured reasoning <span aria-hidden="true">·</span> Source-backed insights{" "}
                <span aria-hidden="true">·</span> You stay in control
              </p>
            </div>

            <div className="lg:col-span-6">
              <HeroPreview />
            </div>
          </div>
        </Container>
      </Section>

      <Section aria-labelledby="differentiators-heading" className="border-border border-t">
        <Container>
          <SectionHeading
            id="differentiators-heading"
            eyebrow="Not just another chat answer"
            title="A structured second opinion, not a confident guess"
            description="A chat window will give you one fluent answer. A decision needs to be inspected, compared, and revisited."
          />

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {DIFFERENTIATORS.map((item) => (
              <Card key={item.title}>
                <CardTitle>{item.title}</CardTitle>
                <CardBody className="mt-2">{item.body}</CardBody>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      <Section aria-labelledby="example-heading" className="border-border bg-surface border-t">
        <Container>
          <SectionHeading
            id="example-heading"
            eyebrow="See it work"
            title="Three fictional people, three different answers"
            description="Switch between situations and watch the recommendation change. These examples are hand-written and involve no AI call, so nothing here is generated on the fly."
          />
          <InteractiveExample />
        </Container>
      </Section>

      <Section aria-labelledby="how-heading" className="border-border border-t">
        <Container>
          <SectionHeading
            id="how-heading"
            eyebrow="How it works"
            title="Ask, structure, explore, act"
          />

          <ol className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.name} className="rounded-card border-border border p-6">
                <span className="border-brand-teal/40 text-brand-teal flex size-8 items-center justify-center rounded-full border text-sm font-semibold">
                  {index + 1}
                </span>
                <h3 className="mt-4 text-base font-semibold">{step.name}</h3>
                <p className="text-text-secondary mt-2 text-sm">{step.body}</p>
              </li>
            ))}
          </ol>

          <p className="mt-8 text-sm">
            <Link href="/how-it-works" className="text-brand-teal font-medium hover:underline">
              Read the full methodology
            </Link>
          </p>
        </Container>
      </Section>

      <Section aria-labelledby="trust-heading" className="border-border bg-surface border-t">
        <Container className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionHeading
              id="trust-heading"
              eyebrow="Methodology and trust"
              title="Why you can check our work"
            />
          </div>
          <div className="space-y-5 lg:col-span-7">
            <p className="text-text-secondary">
              Most of NorthStar is ordinary, inspectable code. A deterministic rules layer owns your
              constraints and permissions. Retrieval draws only on sources a human has reviewed and
              published. The AI step is constrained to a strict output schema, and every citation is
              verified against the evidence actually retrieved before you ever see it.
            </p>
            <p className="text-text-secondary">
              When the evidence is thin, we say so and label the result exploratory rather than
              inventing support for it. NorthStar does not predict outcomes, and it is not a
              substitute for a licensed professional on medical, legal, immigration, or financial
              questions.
            </p>
            <p className="text-sm">
              <Link href="/about" className="text-brand-teal font-medium hover:underline">
                Read about our limitations
              </Link>
            </p>
          </div>
        </Container>
      </Section>

      <Section aria-labelledby="pricing-heading" className="border-border border-t">
        <Container>
          <SectionHeading
            id="pricing-heading"
            eyebrow="Pricing"
            title="Two plans, no puzzle"
            description="Start free. Upgrade only if you are revisiting a decision often enough to need it."
            align="center"
          />
          <PricingCards />
          <p className="text-text-secondary mx-auto mt-6 max-w-2xl text-center text-sm">
            {PRICING_NOTE}
          </p>
        </Container>
      </Section>

      <Section className="border-border bg-surface border-t">
        <Container className="text-center">
          <h2 className="mx-auto max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            You do not need a perfect plan. You need a clear next step.
          </h2>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/sign-up" size="lg">
              Find your next step
            </ButtonLink>
            <ButtonLink href="/how-it-works" variant="secondary" size="lg">
              See how it works
            </ButtonLink>
          </div>
        </Container>
      </Section>
    </>
  );
}
