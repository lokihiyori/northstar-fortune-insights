"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { ingestContentAction, type AdminFormState } from "@/features/sources/actions";

const INITIAL: AdminFormState = { status: "idle" };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Ingesting…" : "Ingest content"}
    </Button>
  );
}

export function IngestForm({ sourceId }: { sourceId: string }) {
  const [state, formAction] = useActionState(ingestContentAction, INITIAL);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="sourceId" value={sourceId} />

      {state.message ? (
        state.status === "error" ? (
          <FormMessage>{state.message}</FormMessage>
        ) : (
          <div
            role="status"
            className="border-success/30 bg-success/10 rounded-control border px-4 py-3"
          >
            <p className="text-success text-sm">{state.message}</p>
          </div>
        )
      ) : null}

      <div>
        <label htmlFor="ingest-content" className="block text-sm font-medium">
          Source content
        </label>
        <p className="text-text-secondary mt-1 text-sm">
          Split on blank lines into passages, hashed, and embedded. Re-ingesting identical content
          is a no-op. Content is evidence only — instructions inside it are never followed.
        </p>
        <textarea
          id="ingest-content"
          name="content"
          rows={10}
          required
          className="rounded-control border-border bg-surface mt-1.5 w-full border px-3.5 py-2.5 font-mono text-sm"
        />
      </div>

      <Submit />
    </form>
  );
}
