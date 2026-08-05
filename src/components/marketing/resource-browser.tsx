"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import {
  RESOURCE_TOPIC_COPY,
  RESOURCE_TYPE_COPY,
  SAMPLE_RESOURCES,
  type ResourceTopic,
} from "@/features/retrieval/sample-resources";

const TOPICS = ["ALL", "CAREER", "EDUCATION", "RELOCATION", "PERSONAL_GOAL"] as const;
type TopicFilter = (typeof TOPICS)[number];

const REGIONS = ["All regions", ...new Set(SAMPLE_RESOURCES.map((r) => r.region))] as const;

function formatReviewed(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function ResourceBrowser() {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<TopicFilter>("ALL");
  const [region, setRegion] = useState<string>("All regions");

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return SAMPLE_RESOURCES.filter((resource) => {
      if (topic !== "ALL" && resource.topic !== (topic as ResourceTopic)) return false;
      if (region !== "All regions" && resource.region !== region) return false;
      if (!needle) return true;
      return (
        resource.title.toLowerCase().includes(needle) ||
        resource.publisher.toLowerCase().includes(needle) ||
        resource.whyRelevant.toLowerCase().includes(needle)
      );
    });
  }, [query, topic, region]);

  return (
    <div className="mt-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <div className="flex-1">
          <label htmlFor="resource-search" className="text-sm font-medium">
            Search resources
          </label>
          <input
            id="resource-search"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Credential assessment, wage data, work permit…"
            className="rounded-control border-border bg-surface placeholder:text-text-secondary mt-1.5 h-11 w-full border px-3.5 text-sm"
          />
        </div>

        <div>
          <label htmlFor="resource-region" className="text-sm font-medium">
            Region
          </label>
          <select
            id="resource-region"
            value={region}
            onChange={(event) => {
              setRegion(event.target.value);
            }}
            className="rounded-control border-border bg-surface mt-1.5 h-11 w-full border px-3 text-sm lg:w-52"
          >
            {REGIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="sr-only">Filter by topic</legend>
        <div className="flex flex-wrap gap-2">
          {TOPICS.map((option) => {
            const active = topic === option;
            return (
              <label
                key={option}
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
                  name="resource-topic"
                  value={option}
                  checked={active}
                  onChange={() => {
                    setTopic(option);
                  }}
                  className="sr-only"
                />
                {option === "ALL" ? "All topics" : RESOURCE_TOPIC_COPY[option]}
              </label>
            );
          })}
        </div>
      </fieldset>

      <p aria-live="polite" className="text-text-secondary mt-6 text-sm">
        {results.length} {results.length === 1 ? "resource" : "resources"}
      </p>

      {results.length === 0 ? (
        <div className="rounded-card border-border bg-surface mt-4 border p-10 text-center">
          <h3 className="text-base font-semibold">No resources match those filters</h3>
          <p className="text-text-secondary mx-auto mt-2 max-w-md text-sm">
            Try a broader region or clear the search box. The library is small and deliberately
            curated — every entry has been read by a person before publication.
          </p>
        </div>
      ) : (
        <ul className="mt-4 grid gap-4 md:grid-cols-2">
          {results.map((resource) => (
            <li key={resource.id} className="rounded-card border-border bg-surface border p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="teal">{RESOURCE_TOPIC_COPY[resource.topic]}</Badge>
                <Badge>{RESOURCE_TYPE_COPY[resource.type]}</Badge>
                <Badge>{resource.region}</Badge>
              </div>

              <h3 className="mt-3 text-base font-semibold">
                <a
                  href={resource.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="hover:text-brand-teal hover:underline"
                >
                  {resource.title}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </h3>

              <p className="text-text-secondary mt-1 text-sm">{resource.publisher}</p>
              <p className="text-text-secondary mt-3 text-sm">{resource.whyRelevant}</p>
              <p className="text-text-secondary mt-4 text-xs">
                Last reviewed {formatReviewed(resource.reviewedAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
