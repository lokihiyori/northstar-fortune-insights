/**
 * Plan presentation data. Phase 6 replaces the pricing here with server-owned
 * Stripe price IDs — nothing on this page may ever be trusted as the source of
 * what a customer is charged.
 */
export type Plan = {
  id: "free" | "plus";
  name: string;
  priceCad: number;
  cadence: string;
  tagline: string;
  features: readonly string[];
  cta: { label: string; href: string };
  featured: boolean;
};

export const PLANS: readonly Plan[] = [
  {
    id: "free",
    name: "Free",
    priceCad: 0,
    cadence: "always",
    tagline: "Enough to make a real decision and see whether the reasoning holds up.",
    features: [
      "3 full insight reports per month",
      "Basic path comparison",
      "One active action plan",
      "Saved history for 30 days",
    ],
    cta: { label: "Create a free account", href: "/sign-up" },
    featured: false,
  },
  {
    id: "plus",
    name: "NorthStar Plus",
    priceCad: 18,
    cadence: "per month",
    tagline: "For an active decision you are revisiting as your situation changes.",
    features: [
      "A higher monthly report allowance, under fair-use limits",
      "Unlimited saved history",
      "Advanced scenario comparison",
      "Report exports",
      "Multiple active action plans",
      "Priority generation queue",
    ],
    cta: { label: "Start with Plus", href: "/sign-up?plan=plus" },
    featured: true,
  },
] as const;

export const PRICING_NOTE =
  "Prices are in Canadian dollars and billed monthly. Applicable GST/HST is added at checkout. Cancel at any time; access continues to the end of the billing period.";
