"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";

/**
 * Starts Checkout or opens the Customer Portal. Both redirect to a Stripe-hosted
 * page — no card details ever touch this application.
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
        { data: { url: string } } | { error: { message: string } };

      if (!response.ok || !("data" in body)) {
        setError("error" in body ? body.error.message : "That did not work. Please try again.");
        setBusy(false);
        return;
      }

      window.location.assign(body.data.url);
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
