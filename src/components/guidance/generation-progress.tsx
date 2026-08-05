"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { GENERATION_STAGES } from "@/features/guidance/composer";

type StatusPayload = {
  status: "PENDING" | "RUNNING" | "READY" | "FAILED";
  stageIndex: number;
  reportId: string | null;
  message: string | null;
};

/**
 * Spec section 5.4: named stages rather than a percentage.
 *
 * There is no fake progress bar that stalls near the end — the panel shows which
 * named stage the server last reported, and nothing more. Only presentation-safe
 * text arrives here; the model's reasoning is never streamed to the client.
 */
export function GenerationProgress({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [state, setState] = useState<StatusPayload>({
    status: "PENDING",
    stageIndex: 0,
    reportId: null,
    message: null,
  });
  const [failed, setFailed] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const response = await fetch(`/api/v1/guidance/${requestId}`, { cache: "no-store" });
        const body = (await response.json()) as
          { data: StatusPayload } | { error: { message: string } };

        if (cancelled.current) return;

        if (!response.ok || !("data" in body)) {
          setFailed("error" in body ? body.error.message : "We lost track of that request.");
          return;
        }

        setState(body.data);

        if (body.data.status === "READY" && body.data.reportId) {
          router.replace(`/app/insights/${body.data.reportId}`);
          return;
        }

        if (body.data.status === "FAILED") {
          setFailed(body.data.message ?? "The analysis did not complete.");
          return;
        }

        timer = setTimeout(() => {
          void poll();
        }, 1200);
      } catch {
        if (!cancelled.current) {
          setFailed("We could not reach the server while your insight was being prepared.");
        }
      }
    }

    void poll();

    return () => {
      cancelled.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [requestId, router]);

  if (failed) {
    return (
      <ErrorState
        title="That analysis did not finish"
        description={
          <>
            <p>{failed}</p>
            <p className="mt-3">
              Nothing was saved and this did not count against your monthly allowance. Your question
              is still on the compose screen.
            </p>
          </>
        }
        action={
          <>
            <ButtonLink href="/app/ask">Try again</ButtonLink>
            <ButtonLink href="/app" variant="secondary">
              Back to dashboard
            </ButtonLink>
          </>
        }
      />
    );
  }

  return (
    <div className="border-border bg-surface rounded-card border p-6">
      <h1 className="text-xl font-semibold tracking-tight">Preparing your insight</h1>
      <p className="text-text-secondary mt-2 text-sm">
        This usually takes under a minute. You can leave this page — the report is saved to your
        history either way.
      </p>

      <ol className="mt-6 space-y-3" aria-live="polite">
        {GENERATION_STAGES.map((stage, index) => {
          const done = index < state.stageIndex;
          const active = index === state.stageIndex && state.status !== "READY";
          return (
            <li key={stage} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                  done && "border-brand-teal bg-brand-teal text-white",
                  active && "border-brand-teal text-brand-teal",
                  !done && !active && "border-border text-text-secondary",
                )}
              >
                {done ? "✓" : index + 1}
              </span>
              <span
                className={cn(
                  "text-sm",
                  done && "text-text-secondary",
                  active && "font-medium",
                  !done && !active && "text-text-secondary opacity-60",
                )}
              >
                {stage}
                {active ? <span className="sr-only"> — in progress</span> : null}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="border-border mt-6 border-t pt-5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            router.push("/app");
          }}
        >
          Continue in the background
        </Button>
      </div>
    </div>
  );
}
