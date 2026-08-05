import type { Metadata } from "next";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { PRICING_NOTE } from "@/features/billing/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Two plans. Start free, upgrade only if you need to.",
};

const FAQ = [
  {
    question: "What counts as one report?",
    answer:
      "One generated insight, including its three paths, evidence, and next actions. Reading, comparing, or converting an existing report into a plan does not consume anything further.",
  },
  {
    question: "Does regenerating a report use another credit?",
    answer:
      "Yes. Updating your assumptions produces a new report version through the full pipeline, so it counts the same as a new report. Both versions stay in your history so you can compare them.",
  },
  {
    question: "Why is there no unlimited plan?",
    answer:
      "Because every report has a real provider cost. Advertising unlimited use and then rate-limiting quietly is worse than stating a fair-use limit up front.",
  },
  {
    question: "What happens to my history if I cancel?",
    answer:
      "You return to the Free plan and history beyond 30 days becomes read-limited rather than deleted. You can export your data at any time from Settings.",
  },
] as const;

export default function PricingPage() {
  return (
    <>
      <Section className="aurora-glow pb-6">
        <Container>
          <SectionHeading
            eyebrow="Pricing"
            title="Two plans, no puzzle"
            description="More tiers would only make the choice harder. Start free and upgrade if you are revisiting a decision often enough to feel the limit."
            align="center"
          />
        </Container>
      </Section>

      <Section className="pt-0">
        <Container>
          <PricingCards />
          <p className="text-text-secondary mx-auto mt-6 max-w-2xl text-center text-sm">
            {PRICING_NOTE}
          </p>
        </Container>
      </Section>

      <Section aria-labelledby="faq-heading" className="border-border bg-surface border-t">
        <Container>
          <h2 id="faq-heading" className="text-xl font-semibold tracking-tight">
            Questions worth answering before you pay
          </h2>

          <dl className="mt-8 grid gap-6 md:grid-cols-2">
            {FAQ.map((item) => (
              <div key={item.question} className="rounded-card border-border border p-6">
                <dt className="text-base font-semibold">{item.question}</dt>
                <dd className="text-text-secondary mt-2 text-sm">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </Section>
    </>
  );
}
