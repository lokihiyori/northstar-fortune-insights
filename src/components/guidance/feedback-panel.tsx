"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { submitFeedback } from "@/features/guidance/feedback";
import { FEEDBACK_TAGS } from "@/features/guidance/feedback-tags";

const RATINGS = [
  { value: "USEFUL", label: "This was useful" },
  { value: "PARTLY_USEFUL", label: "Partly useful" },
  { value: "NOT_USEFUL", label: "Not useful" },
] as const;

function SubmitButton({ saved }: { saved: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : saved ? "Update feedback" : "Send feedback"}
    </Button>
  );
}

/** Spec section 5.5: rating, structured tags, and an optional comment. */
export function FeedbackPanel({
  reportId,
  existing,
}: {
  reportId: string;
  existing: { rating: string; tags: string[]; comment: string | null } | null;
}) {
  const [rating, setRating] = useState(existing?.rating ?? "");

  return (
    <form
      action={submitFeedback}
      className="border-border bg-surface rounded-card border p-5"
      aria-labelledby="feedback-heading"
    >
      <input type="hidden" name="reportId" value={reportId} />

      <h2 id="feedback-heading" className="text-sm font-semibold">
        Was this useful?
      </h2>
      <p className="text-text-secondary mt-1 text-sm">
        This is how the guidance improves. Nothing you write here is shown to anyone else.
      </p>

      <fieldset className="mt-4">
        <legend className="sr-only">Rating</legend>
        <div className="flex flex-wrap gap-2">
          {RATINGS.map((option) => {
            const active = rating === option.value;
            return (
              <label
                key={option.value}
                className={cn(
                  "cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-colors duration-150",
                  "focus-within:outline-brand-teal focus-within:outline-2 focus-within:outline-offset-2",
                  active
                    ? "border-brand-teal bg-brand-teal/10"
                    : "border-border text-text-secondary hover:bg-surface-raised",
                )}
              >
                <input
                  type="radio"
                  name="rating"
                  value={option.value}
                  checked={active}
                  onChange={() => {
                    setRating(option.value);
                  }}
                  className="sr-only"
                />
                {option.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* The detail only matters once a rating exists, so it stays out of the way. */}
      {rating ? (
        <>
          <fieldset className="mt-5">
            <legend className="text-sm font-medium">What should be different?</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {FEEDBACK_TAGS.map((tag) => (
                <label
                  key={tag}
                  className="border-border hover:bg-surface-raised focus-within:outline-brand-teal cursor-pointer rounded-full border px-3 py-1 text-sm focus-within:outline-2 focus-within:outline-offset-2"
                >
                  <input
                    type="checkbox"
                    name={`tag:${tag}`}
                    defaultChecked={existing?.tags.includes(tag)}
                    className="mr-2 align-middle"
                  />
                  {tag}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-4">
            <label htmlFor="feedback-comment" className="block text-sm font-medium">
              Anything else <span className="text-text-secondary">(optional)</span>
            </label>
            <textarea
              id="feedback-comment"
              name="comment"
              rows={3}
              defaultValue={existing?.comment ?? ""}
              className="rounded-control border-border bg-surface mt-1.5 w-full border px-3.5 py-2.5 text-base sm:text-sm"
            />
          </div>

          <div className="mt-4">
            <SubmitButton saved={Boolean(existing)} />
          </div>
        </>
      ) : null}

      {existing ? (
        <p className="text-text-secondary mt-3 text-xs" role="status">
          Your feedback on this report is saved.
        </p>
      ) : null}
    </form>
  );
}
