import { describe, expect, it } from "vitest";
import { fakeProvider, hallucinatingProvider } from "@/features/guidance/ai/fake-provider";
import { validateGeneratedReport } from "@/features/guidance/validation";
import type { GeneratedReport } from "@/features/guidance/schema";
import type { GuidanceInput } from "@/features/guidance/rules/types";
import type { EvidenceChunk } from "@/features/retrieval/repository";

const input: GuidanceInput = {
  topic: "CAREER",
  question: "Should I move from operations into product management this year?",
  criteria: [
    { key: "LEARNING", weight: 5 },
    { key: "STABILITY", weight: 3 },
  ],
  profile: {
    region: "Toronto, Ontario",
    careerStage: "MID_CAREER",
    currentRole: "Operations lead",
    primaryGoal: "Move into product",
    timeframe: "WITHIN_1_YEAR",
  },
  constraints: [],
  includeProfile: true,
};

function evidence(sourceIds: string[]): EvidenceChunk[] {
  return sourceIds.map((sourceId, index) => ({
    sourceId,
    chunkId: `chunk-${String(index)}`,
    title: "A reviewed source",
    publisher: "Government of Canada",
    region: "Canada",
    canonicalUrl: "https://example.gc.ca/",
    text: "Some retrieved passage text.",
    similarity: 0.8,
  }));
}

async function generate(sourceIds: string[]) {
  const outcome = await fakeProvider.generate({
    input,
    evidence: evidence(sourceIds),
    timeoutMs: 1000,
  });
  if (!outcome.ok) throw new Error("fake provider should not fail");
  return outcome.raw;
}

describe("citation allow-list", () => {
  it("accepts a report citing only retrieved sources", async () => {
    const raw = await generate(["src-a", "src-b", "src-c"]);
    const result = validateGeneratedReport(raw, new Set(["src-a", "src-b", "src-c"]));

    expect(result.ok).toBe(true);
  });

  it("rejects a report citing a source that was never retrieved", async () => {
    // The single most damaging failure mode: a fabricated but plausible id.
    const outcome = await hallucinatingProvider("src-invented").generate({
      input,
      evidence: evidence(["src-a"]),
      timeoutMs: 1000,
    });
    if (!outcome.ok) throw new Error("expected output");

    const result = validateGeneratedReport(outcome.raw, new Set(["src-a"]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("UNKNOWN_CITATION");
    expect(result.failure.details.join(" ")).toContain("src-invented");
  });

  it("rejects every citation when the evidence packet was empty", async () => {
    const raw = await generate(["src-a"]);
    const result = validateGeneratedReport(raw, new Set());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("UNKNOWN_CITATION");
  });
});

describe("output schema", () => {
  it("requires exactly three paths", async () => {
    const raw = (await generate(["src-a"])) as GeneratedReport;
    const twoPaths = { ...raw, paths: raw.paths.slice(0, 2) };

    const result = validateGeneratedReport(twoPaths, new Set(["src-a"]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("SCHEMA_INVALID");
  });

  it("requires the three paths to have distinct labels", async () => {
    const raw = (await generate(["src-a"])) as GeneratedReport;
    const duplicated = {
      ...raw,
      paths: raw.paths.map((path) => ({ ...path, label: "BEST_FIT" as const })),
    };

    const result = validateGeneratedReport(duplicated, new Set(["src-a"]));
    expect(result.ok).toBe(false);
  });

  it("refuses a STRONG fit on a path with no evidence", async () => {
    // The rule the product's credibility rests on, enforced structurally.
    const raw = (await generate(["src-a"])) as GeneratedReport;
    const [first, ...rest] = raw.paths;
    const bad = {
      ...raw,
      paths: [{ ...first!, evidence: [], fit: "STRONG" as const }, ...rest],
    };

    const result = validateGeneratedReport(bad, new Set(["src-a"]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.details.join(" ")).toContain("STRONG");
  });

  it("rejects entirely malformed output rather than repairing it", () => {
    for (const junk of [null, {}, { paths: [] }, "not an object", 42]) {
      expect(validateGeneratedReport(junk, new Set()).ok).toBe(false);
    }
  });

  it("never leaks provider internals in the failure details", () => {
    const result = validateGeneratedReport({ secret: "sk-live-123" }, new Set());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.failure)).not.toContain("sk-live-123");
  });
});

describe("fake provider", () => {
  it("produces schema-valid output with no evidence available", async () => {
    const raw = await generate([]);
    const result = validateGeneratedReport(raw, new Set());

    expect(result.ok).toBe(true);
  });

  it("labels every path exploratory when nothing could be retrieved", async () => {
    const raw = (await generate([])) as GeneratedReport;
    // Spec section 9: insufficient evidence must produce an exploratory result.
    expect(raw.paths.every((path) => path.fit === "EXPLORATORY")).toBe(true);
    expect(raw.paths.every((path) => path.evidence.length === 0)).toBe(true);
  });

  it("is deterministic for the same input", async () => {
    const [a, b] = await Promise.all([generate(["src-a"]), generate(["src-a"])]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
