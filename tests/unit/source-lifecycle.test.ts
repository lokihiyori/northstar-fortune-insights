import { describe, expect, it } from "vitest";
import {
  TRANSITIONS,
  canTransition,
  checkPublishable,
  checkTransition,
  isRetrievable,
  type PublishReadiness,
} from "@/features/sources/lifecycle";
import type { SourceStatus } from "@/generated/prisma/enums";

const ALL: SourceStatus[] = ["DRAFT", "REVIEWED", "PUBLISHED", "RETIRED"];

function readySource(overrides: Partial<PublishReadiness> = {}): PublishReadiness {
  return {
    status: "REVIEWED",
    title: "Job Bank career outlook",
    publisher: "Government of Canada",
    region: "Canada",
    canonicalUrl: "https://jobbank.gc.ca/",
    summary: "Provincial employment outlook and wage ranges by occupation.",
    chunkCount: 3,
    embeddedChunkCount: 3,
    ...overrides,
  };
}

describe("lifecycle transitions", () => {
  it("allows the documented path Draft to Reviewed to Published", () => {
    expect(canTransition("DRAFT", "REVIEWED")).toBe(true);
    expect(canTransition("REVIEWED", "PUBLISHED")).toBe(true);
  });

  it("refuses publishing straight from draft, skipping review", () => {
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(false);
  });

  it("refuses moving a published source back to draft", () => {
    // Reports may already cite it; the only way out is retirement.
    expect(canTransition("PUBLISHED", "DRAFT")).toBe(false);
    expect(canTransition("PUBLISHED", "REVIEWED")).toBe(false);
  });

  it("allows retirement from any live state", () => {
    for (const from of ["DRAFT", "REVIEWED", "PUBLISHED"] as SourceStatus[]) {
      expect(canTransition(from, "RETIRED")).toBe(true);
    }
  });

  it("requires a retired source to be re-reviewed before it can go live again", () => {
    expect(canTransition("RETIRED", "PUBLISHED")).toBe(false);
    expect(canTransition("RETIRED", "REVIEWED")).toBe(true);
  });

  it("never allows a transition to itself", () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("defines transitions for every status", () => {
    for (const status of ALL) {
      expect(TRANSITIONS[status]).toBeDefined();
    }
  });

  it("explains a refusal rather than failing silently", () => {
    const result = checkTransition("DRAFT", "PUBLISHED");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/draft/i);
    expect(result.reason).toMatch(/published/i);
  });

  it("tells the admin review comes first — the message the publish path produces", () => {
    // The service routes PUBLISHED through checkPublishable, so this is the
    // wording an admin actually sees when trying to publish a draft.
    const result = checkPublishable(readySource({ status: "DRAFT" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/reviewed/i);
  });
});

describe("checkPublishable", () => {
  it("accepts a reviewed source with complete metadata and embedded content", () => {
    expect(checkPublishable(readySource()).ok).toBe(true);
  });

  it("refuses a source that has not been reviewed", () => {
    const result = checkPublishable(readySource({ status: "DRAFT" }));
    expect(result.ok).toBe(false);
  });

  it("refuses a source with no ingested content", () => {
    const result = checkPublishable(readySource({ chunkCount: 0, embeddedChunkCount: 0 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no ingested content/i);
  });

  it("refuses a source whose passages are not fully embedded", () => {
    // Publishing this would look live while contributing nothing to retrieval.
    const result = checkPublishable(readySource({ chunkCount: 3, embeddedChunkCount: 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/embedded/i);
  });

  it("refuses incomplete metadata, field by field", () => {
    for (const patch of [
      { title: "ab" },
      { publisher: "" },
      { region: "" },
      { canonicalUrl: "not-a-url" },
      { summary: null },
    ] as Partial<PublishReadiness>[]) {
      expect(checkPublishable(readySource(patch)).ok).toBe(false);
    }
  });
});

describe("isRetrievable", () => {
  it("is true only for a published, non-deleted source", () => {
    expect(isRetrievable("PUBLISHED", null)).toBe(true);
  });

  it("is false for every other status", () => {
    for (const status of ["DRAFT", "REVIEWED", "RETIRED"] as SourceStatus[]) {
      expect(isRetrievable(status, null)).toBe(false);
    }
  });

  it("is false for a soft-deleted source even if published", () => {
    expect(isRetrievable("PUBLISHED", new Date())).toBe(false);
  });
});
