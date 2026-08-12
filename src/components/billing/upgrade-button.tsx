"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";

/**
 * Starts Checkout or opens the Customer Portal.
 *
 * **The Checkout URL never reaches this component.** It is bearer-like — anyone
 * holding it can complete the payment — so the server returns only a path, and
 * the browser navigates there for a server-side revalidated redirect. Client
 * code therefore has no URL to log, copy into analytics, or attach to an error
 * report.
 */
export function BillingActionButton({
  endpoint,
  label,
  variant = "primary",
  disabled = false,
}: {
  endpoint: "checkout" | "portal";
  label: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/billing/${endpoint}`, { method: "POST" });
      const body = (await response.json()) as
        { data: { url?: string; continuePath?: string } } | { error: { message: string } };

      if (!response.ok || !("data" in body)) {
        setError("error" in body ? body.error.message : "That did not work. Please try again.");
        setBusy(false);
        return;
      }

      // Checkout returns a path we navigate to; the Portal returns its URL
      // directly because a portal session is not a payment bearer token.
      const destination = body.data.continuePath ?? body.data.url;
      if (!destination) {
        setError("That did not work. Please try again.");
        setBusy(false);
        return;
      }

      window.location.assign(destination);
    } catch {
      setError("We could not reach the billing service.");
      setBusy(false);
    }
  }

  return (
    <div>
      <Button
        type="button"
        variant={variant}
        disabled={busy || disabled}
        onClick={() => {
          void go();
        }}
      >
        {busy ? "Opening…" : label}
      </Button>
      {error ? (
        <div className="mt-3">
          <FormMessage>{error}</FormMessage>
        </div>
      ) : null}
    </div>
  );
}

/** Plain link for continuing an existing Checkout. No fetch, no URL in JS. */
export function ContinueCheckoutLink({ label }: { label: string }) {
  return (
    <a
      href="/api/v1/billing/checkout/continue"
      className="bg-brand text-on-brand rounded-control focus-visible:outline-brand inline-flex h-11 items-center px-5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {label}
    </a>
  );
}
