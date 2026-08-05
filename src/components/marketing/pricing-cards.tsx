import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PLANS } from "@/features/billing/plans";
import { cn } from "@/lib/cn";

export function PricingCards() {
  return (
    <div className="mt-10 grid gap-6 md:grid-cols-2">
      {PLANS.map((plan) => (
        <div
          key={plan.id}
          className={cn(
            "rounded-card flex flex-col border p-6",
            plan.featured ? "border-brand-teal bg-surface" : "border-border bg-surface",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-lg font-semibold">{plan.name}</h3>
            {plan.featured ? <Badge tone="teal">Most useful</Badge> : null}
          </div>

          <p className="text-text-secondary mt-2 text-sm">{plan.tagline}</p>

          <p className="mt-5">
            <span className="font-display text-3xl font-semibold">
              {plan.priceCad === 0 ? "$0" : `$${String(plan.priceCad)}`}
            </span>
            <span className="text-text-secondary ml-2 text-sm">CAD {plan.cadence}</span>
          </p>

          <ul className="mt-6 flex-1 space-y-2.5 text-sm">
            {plan.features.map((feature) => (
              <li key={feature} className="flex gap-2.5">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-brand-teal mt-0.5 size-4 shrink-0"
                >
                  <path d="M4 10.5 8 14.5 16 6" />
                </svg>
                <span className="text-text-secondary">{feature}</span>
              </li>
            ))}
          </ul>

          <ButtonLink
            href={plan.cta.href}
            variant={plan.featured ? "primary" : "secondary"}
            className="mt-7 w-full"
          >
            {plan.cta.label}
          </ButtonLink>
        </div>
      ))}
    </div>
  );
}
