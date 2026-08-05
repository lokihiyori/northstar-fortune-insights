"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/ui/field";
import { TOPIC_VALUES } from "@/features/sources/validation";
import {
  createSourceAction,
  updateSourceAction,
  type AdminFormState,
} from "@/features/sources/actions";
import { TOPIC_COPY } from "@/features/guidance/types";
import type { Topic } from "@/features/guidance/types";

const INITIAL: AdminFormState = { status: "idle" };

export type SourceFormValues = {
  title: string;
  publisher: string;
  region: string;
  topic: string;
  canonicalUrl: string;
  summary: string;
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function SourceForm({
  mode,
  sourceId,
  initial,
}: {
  mode: "create" | "edit";
  sourceId?: string;
  initial?: SourceFormValues;
}) {
  const [state, formAction] = useActionState(
    mode === "create" ? createSourceAction : updateSourceAction,
    INITIAL,
  );

  // On a failed submit the server echoes back what was typed, so nothing is lost.
  const value = (key: keyof SourceFormValues) => state.values?.[key] ?? initial?.[key] ?? "";
  const errors = state.fieldErrors;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {sourceId ? <input type="hidden" name="sourceId" value={sourceId} /> : null}

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

      <Field
        id="title"
        name="title"
        label="Title"
        required
        defaultValue={value("title")}
        errors={errors?.["title"]}
      />

      <Field
        id="publisher"
        name="publisher"
        label="Publisher"
        hint="The organisation that stands behind the content — this is shown as the citation."
        required
        defaultValue={value("publisher")}
        errors={errors?.["publisher"]}
      />

      <Field
        id="canonicalUrl"
        name="canonicalUrl"
        label="Canonical URL"
        hint="Normalised on save: https is forced, tracking parameters and fragments are removed, so the same page cannot be added twice."
        required
        defaultValue={value("canonicalUrl")}
        errors={errors?.["canonicalUrl"]}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="region"
          name="region"
          label="Region"
          hint='Use "Canada" for national sources.'
          required
          defaultValue={value("region")}
          errors={errors?.["region"]}
        />

        <div>
          <label htmlFor="topic" className="block text-sm font-medium">
            Topic
          </label>
          <select
            id="topic"
            name="topic"
            defaultValue={value("topic") || "CAREER"}
            className="rounded-control border-border bg-surface mt-1.5 h-11 w-full border px-3 text-base sm:text-sm"
          >
            {TOPIC_VALUES.map((topic) => (
              <option key={topic} value={topic}>
                {TOPIC_COPY[topic as Topic]}
              </option>
            ))}
          </select>
          {errors?.["topic"] ? (
            <p className="text-danger mt-1.5 text-sm">{errors["topic"][0]}</p>
          ) : null}
        </div>
      </div>

      <div>
        <label htmlFor="summary" className="block text-sm font-medium">
          Why this source is relevant
        </label>
        <p className="text-text-secondary mt-1 text-sm">
          Shown to users in the resource library. Required before publishing.
        </p>
        <textarea
          id="summary"
          name="summary"
          rows={3}
          defaultValue={value("summary")}
          className="rounded-control border-border bg-surface mt-1.5 w-full border px-3.5 py-2.5 text-base sm:text-sm"
        />
        {errors?.["summary"] ? (
          <p className="text-danger mt-1.5 text-sm">{errors["summary"][0]}</p>
        ) : null}
      </div>

      {mode === "create" ? (
        <div>
          <label htmlFor="content" className="block text-sm font-medium">
            Content <span className="text-text-secondary">(optional)</span>
          </label>
          <p className="text-text-secondary mt-1 text-sm">
            Paste the passages to ingest. Treated strictly as evidence — any instructions inside it
            are never followed. You can add this later.
          </p>
          <textarea
            id="content"
            name="content"
            rows={8}
            defaultValue={state.values?.["content"] ?? ""}
            className="rounded-control border-border bg-surface mt-1.5 w-full border px-3.5 py-2.5 font-mono text-sm"
          />
        </div>
      ) : null}

      <Submit label={mode === "create" ? "Create source" : "Save changes"} />
    </form>
  );
}
