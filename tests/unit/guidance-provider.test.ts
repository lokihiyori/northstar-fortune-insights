import { describe, expect, it } from "vitest";
import { failingProvider } from "@/features/guidance/ai/fake-provider";
import { withTimeout, type GenerationOutcome } from "@/features/guidance/ai/provider";
import {
  deterministicEmbedder,
  EMBEDDING_DIMENSIONS,
  toVectorLiteral,
} from "@/features/retrieval/embedder";
import { composerSchema } from "@/features/guidance/composer";

describe("provider failure modes", () => {
  it("reports each injected failure without throwing", async () => {
    for (const code of ["TIMEOUT", "PROVIDER_ERROR", "RATE_LIMITED", "NOT_CONFIGURED"] as const) {
      const outcome = await failingProvider(code).generate({
        input: {
          topic: "CAREER",
          question: "x",
          criteria: [],
          profile: {
            region: null,
            careerStage: null,
            currentRole: null,
            primaryGoal: null,
            timeframe: null,
          },
          constraints: [],
          includeProfile: false,
        },
        evidence: [],
        timeoutMs: 100,
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.code).toBe(code);
    }
  });
});

describe("withTimeout", () => {
  it("returns the timeout value when the provider is too slow", async () => {
    const slow = new Promise<GenerationOutcome>((resolve) => {
      setTimeout(() => {
        resolve({ ok: true, raw: {}, modelName: "slow", latencyMs: 0 });
      }, 500);
    });

    const outcome = await withTimeout<GenerationOutcome>(slow, 30, () => ({
      ok: false,
      code: "TIMEOUT",
      message: "timed out",
    }));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("TIMEOUT");
  });

  it("returns the real result when the provider is fast enough", async () => {
    const fast = Promise.resolve<GenerationOutcome>({
      ok: true,
      raw: { done: true },
      modelName: "fast",
      latencyMs: 1,
    });

    const outcome = await withTimeout<GenerationOutcome>(fast, 500, () => ({
      ok: false,
      code: "TIMEOUT",
      message: "timed out",
    }));

    expect(outcome.ok).toBe(true);
  });
});

describe("deterministic embedder", () => {
  it("produces fixed-width unit vectors", async () => {
    const [vector] = await deterministicEmbedder.embed(["credential recognition in Ontario"]);

    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    const magnitude = Math.sqrt(vector!.reduce((sum, value) => sum + value * value, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it("is deterministic", async () => {
    const [a] = await deterministicEmbedder.embed(["the same sentence"]);
    const [b] = await deterministicEmbedder.embed(["the same sentence"]);
    expect(a).toEqual(b);
  });

  it("scores related text above unrelated text", async () => {
    const [query, related, unrelated] = await deterministicEmbedder.embed([
      "accounting credential recognition for newcomers",
      "credential recognition for internationally trained accountants",
      "apprenticeship wages for electricians in Alberta",
    ]);

    const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);

    expect(dot(query!, related!)).toBeGreaterThan(dot(query!, unrelated!));
  });

  it("handles text with no usable tokens without dividing by zero", async () => {
    const [vector] = await deterministicEmbedder.embed(["!!! ?? ..."]);
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(vector!.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("formats vectors as pgvector literals", () => {
    expect(toVectorLiteral([0.5, -0.25, 0])).toBe("[0.5,-0.25,0]");
  });
});

describe("composer input schema", () => {
  const base = {
    topic: "CAREER",
    question: "Should I take the offer at the larger company?",
    criteria: [{ key: "STABILITY", weight: 3 }],
    includeProfile: true,
  };

  it("accepts a well-formed submission", () => {
    expect(composerSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a question that is too short to reason about", () => {
    expect(composerSchema.safeParse({ ...base, question: "help" }).success).toBe(false);
  });

  it("rejects more than five criteria", () => {
    const criteria = ["INCOME", "STABILITY", "SPEED", "FLEXIBILITY", "LEARNING", "IMPACT"].map(
      (key) => ({ key, weight: 3 }),
    );
    expect(composerSchema.safeParse({ ...base, criteria }).success).toBe(false);
  });

  it("rejects a duplicated criterion", () => {
    const criteria = [
      { key: "INCOME", weight: 3 },
      { key: "INCOME", weight: 5 },
    ];
    expect(composerSchema.safeParse({ ...base, criteria }).success).toBe(false);
  });

  it("rejects weights outside 1-5", () => {
    for (const weight of [0, 6, 2.5]) {
      expect(
        composerSchema.safeParse({ ...base, criteria: [{ key: "INCOME", weight }] }).success,
      ).toBe(false);
    }
  });
});
