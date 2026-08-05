"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormMessage } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import {
  DECISION_CRITERIA,
  MAX_CRITERIA,
  MAX_QUESTION_LENGTH,
  QUESTION_STARTERS,
  TOPICS,
  composerSchema,
  type CriterionKey,
} from "@/features/guidance/composer";
import type { Topic } from "@/features/guidance/types";

export type ComposerContext = {
  region: string | null;
  careerStage: string | null;
  currentRole: string | null;
  primaryGoal: string | null;
  timeframe: string | null;
  constraints: Array<{ id: string; label: string }>;
};

const STEP_TITLES = [
  "What is this about?",
  "What do you want to know?",
  "What should we send with it?",
  "What matters most in this decision?",
  "Ready to analyse",
] as const;

const TOTAL = STEP_TITLES.length;

export function QuestionComposer({
  context,
  reportsRemaining,
}: {
  context: ComposerContext;
  reportsRemaining: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [question, setQuestion] = useState("");
  const [includeProfile, setIncludeProfile] = useState(true);
  const [criteria, setCriteria] = useState<Array<{ key: CriterionKey; weight: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const starters = topic ? QUESTION_STARTERS[topic] : [];
  const selectedKeys = useMemo(() => new Set(criteria.map((c) => c.key)), [criteria]);

  function toggleCriterion(key: CriterionKey) {
    setCriteria((current) => {
      if (current.some((item) => item.key === key)) {
        return current.filter((item) => item.key !== key);
      }
      if (current.length >= MAX_CRITERIA) return current;
      return [...current, { key, weight: 3 }];
    });
  }

  function setWeight(key: CriterionKey, weight: number) {
    setCriteria((current) =>
      current.map((item) => (item.key === key ? { ...item, weight } : item)),
    );
  }

  function canAdvance(): boolean {
    if (step === 1) return topic !== null;
    if (step === 2) return question.trim().length >= 15;
    if (step === 4) return criteria.length > 0;
    return true;
  }

  async function submit() {
    setError(null);

    const parsed = composerSchema.safeParse({ topic, question, criteria, includeProfile });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your answers and try again.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/v1/guidance", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Lets the server collapse duplicate submissions from a double click.
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(parsed.data),
      });

      const body = (await response.json()) as
        { data: { requestId: string } } | { error: { message: string } };

      if (!response.ok || !("data" in body)) {
        setError(
          "error" in body
            ? body.error.message
            : "We could not start that analysis. Please try again.",
        );
        setSubmitting(false);
        return;
      }

      // The form is preserved until navigation succeeds, so a failure here
      // never loses what the user typed.
      router.push(`/app/ask/${body.data.requestId}`);
    } catch {
      setError("We could not reach the server. Your question has not been lost — try again.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <ol className="flex flex-wrap gap-2" aria-label="Progress">
        {STEP_TITLES.map((title, index) => {
          const n = index + 1;
          const state = n === step ? "current" : n < step ? "done" : "upcoming";
          return (
            <li key={title}>
              <span
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  state === "current" && "border-brand-teal bg-brand-teal/10 text-text-primary",
                  state === "done" && "border-border text-text-secondary",
                  state === "upcoming" && "border-border text-text-secondary opacity-60",
                )}
              >
                {n}. {title}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-8">
        <h1 className="text-2xl font-semibold tracking-tight">{STEP_TITLES[step - 1]}</h1>

        {step === 1 ? (
          <fieldset className="mt-6">
            <legend className="sr-only">Choose a topic</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {TOPICS.map((option) => {
                const active = topic === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      "rounded-card cursor-pointer border p-4 transition-colors duration-150",
                      "focus-within:outline-brand-teal focus-within:outline-2 focus-within:outline-offset-2",
                      active
                        ? "border-brand-teal bg-brand-teal/5"
                        : "border-border hover:bg-surface-raised",
                    )}
                  >
                    <input
                      type="radio"
                      name="topic"
                      value={option.value}
                      checked={active}
                      onChange={() => {
                        setTopic(option.value);
                      }}
                      className="sr-only"
                    />
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className="text-text-secondary mt-1 block text-sm">{option.blurb}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {step === 2 ? (
          <div className="mt-6">
            <label htmlFor="question" className="block text-sm font-medium">
              Your decision question
            </label>
            <p className="text-text-secondary mt-1 text-sm">
              A good question names the choice you are actually facing.
            </p>
            <textarea
              id="question"
              rows={5}
              value={question}
              maxLength={MAX_QUESTION_LENGTH}
              onChange={(event) => {
                setQuestion(event.target.value);
              }}
              className="rounded-control border-border bg-surface mt-2 w-full border px-3.5 py-2.5 text-base sm:text-sm"
            />
            <p className="text-text-secondary mt-1 text-xs">
              {question.trim().length} characters. At least 15.
            </p>

            {starters.length > 0 ? (
              <div className="mt-5">
                <h2 className="text-sm font-medium">Starting points</h2>
                <ul className="mt-2 space-y-2">
                  {starters.map((starter) => (
                    <li key={starter}>
                      <button
                        type="button"
                        onClick={() => {
                          setQuestion(starter);
                        }}
                        className="border-border hover:bg-surface-raised rounded-control w-full border px-3 py-2 text-left text-sm"
                      >
                        {starter}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mt-6">
            <p className="text-text-secondary text-sm">
              This is exactly what leaves your account with this question. Nothing else from your
              profile is sent.
            </p>

            <div className="border-border bg-surface rounded-card mt-4 border p-5">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={includeProfile}
                  onChange={(event) => {
                    setIncludeProfile(event.target.checked);
                  }}
                  className="border-border mt-0.5 size-4 rounded"
                />
                <span>
                  <span className="block text-sm font-medium">Include my compass context</span>
                  <span className="text-text-secondary block text-sm">
                    Without it the analysis is more generic and will list more missing information.
                  </span>
                </span>
              </label>

              <dl
                className={cn(
                  "mt-5 space-y-3 text-sm transition-opacity",
                  includeProfile ? "opacity-100" : "opacity-40",
                )}
              >
                {[
                  ["Region", context.region],
                  ["Stage", context.careerStage],
                  ["Current role", context.currentRole],
                  ["Goal", context.primaryGoal],
                  ["Timeframe", context.timeframe],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-text-secondary text-xs">{label}</dt>
                    <dd className={value ? "" : "text-text-secondary italic"}>
                      {value ?? "Not set"}
                    </dd>
                  </div>
                ))}
                <div>
                  <dt className="text-text-secondary text-xs">Constraints</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {context.constraints.length === 0 ? (
                      <span className="text-text-secondary italic">None recorded</span>
                    ) : (
                      context.constraints.map((constraint) => (
                        <Badge key={constraint.id}>{constraint.label}</Badge>
                      ))
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="mt-6">
            <p className="text-text-secondary text-sm">
              Choose up to {MAX_CRITERIA}. Weights order the paths — they are not a formula, and the
              report always shows the ranking it used.
            </p>

            <fieldset className="mt-4">
              <legend className="sr-only">Decision criteria</legend>
              <div className="flex flex-wrap gap-2">
                {DECISION_CRITERIA.map((criterion) => {
                  const active = selectedKeys.has(criterion.key);
                  const atLimit = !active && criteria.length >= MAX_CRITERIA;
                  return (
                    <label
                      key={criterion.key}
                      className={cn(
                        "rounded-full border px-3.5 py-1.5 text-sm transition-colors duration-150",
                        "focus-within:outline-brand-teal focus-within:outline-2 focus-within:outline-offset-2",
                        atLimit ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                        active
                          ? "border-brand-teal bg-brand-teal/10"
                          : "border-border text-text-secondary hover:bg-surface-raised",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        disabled={atLimit}
                        onChange={() => {
                          toggleCriterion(criterion.key);
                        }}
                        className="sr-only"
                      />
                      {criterion.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {criteria.length > 0 ? (
              <div className="mt-6 space-y-4">
                {criteria.map((item) => {
                  const label =
                    DECISION_CRITERIA.find((c) => c.key === item.key)?.label ?? item.key;
                  const id = `weight-${item.key}`;
                  return (
                    <div key={item.key}>
                      <div className="flex items-center justify-between gap-3">
                        <label htmlFor={id} className="text-sm font-medium">
                          {label}
                        </label>
                        <span className="text-text-secondary text-xs">
                          {["Slight", "Some", "Moderate", "High", "Decisive"][item.weight - 1]}
                        </span>
                      </div>
                      <input
                        id={id}
                        type="range"
                        min={1}
                        max={5}
                        step={1}
                        value={item.weight}
                        onChange={(event) => {
                          setWeight(item.key, Number(event.target.value));
                        }}
                        className="accent-brand-teal mt-1 w-full"
                      />
                    </div>
                  );
                })}

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCriteria([]);
                  }}
                >
                  Reset criteria
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 5 ? (
          <div className="mt-6 space-y-5">
            <div className="border-border bg-surface rounded-card border p-5">
              <h2 className="text-sm font-semibold">What will be analysed</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-text-secondary text-xs">Topic</dt>
                  <dd>{TOPICS.find((t) => t.value === topic)?.label}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary text-xs">Question</dt>
                  <dd>{question.trim()}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary text-xs">Criteria</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {criteria.map((item, index) => (
                      <Badge key={item.key} tone="teal">
                        {index + 1}. {DECISION_CRITERIA.find((c) => c.key === item.key)?.label}
                      </Badge>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-secondary text-xs">Compass context</dt>
                  <dd>{includeProfile ? "Included" : "Not included"}</dd>
                </div>
              </dl>
            </div>

            <div className="border-border bg-surface-raised rounded-control border p-4">
              <p className="text-text-secondary text-sm">
                Your question and the fields above are sent to our AI provider along with passages
                from reviewed public sources. Your email address and account identifier are not.
                This report counts as one of your {reportsRemaining} remaining this month.
              </p>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mt-6">
            <FormMessage>{error}</FormMessage>
          </div>
        ) : null}

        <div className="border-border mt-8 flex flex-wrap items-center gap-3 border-t pt-6">
          {step > 1 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setStep((s) => s - 1);
              }}
              disabled={submitting}
            >
              Back
            </Button>
          ) : null}

          {step < TOTAL ? (
            <Button
              type="button"
              onClick={() => {
                setStep((s) => s + 1);
              }}
              disabled={!canAdvance()}
            >
              Continue
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              onClick={() => {
                void submit();
              }}
              disabled={submitting || reportsRemaining <= 0}
            >
              {submitting ? "Starting…" : "Generate my insight"}
            </Button>
          )}

          {step === TOTAL && reportsRemaining <= 0 ? (
            <p className="text-text-secondary text-sm">You have used this month&rsquo;s reports.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
