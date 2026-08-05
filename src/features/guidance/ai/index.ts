import "server-only";

import { deterministicEmbedder, type Embedder } from "@/features/retrieval/embedder";
import { fakeProvider } from "./fake-provider";
import { createOpenAIProvider } from "./openai-provider";
import type { GuidanceProvider } from "./provider";

/**
 * Provider selection.
 *
 * Without `OPENAI_API_KEY` the deterministic provider is used. That is the
 * default for development, tests, and CI — the product must be fully
 * demonstrable with no provider account, and no test may quietly spend money.
 */
export function resolveProvider(): GuidanceProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fakeProvider;

  return createOpenAIProvider(apiKey, process.env.OPENAI_MODEL || undefined);
}

/**
 * The embedder must match whatever embedded the stored chunks. Mixing models
 * silently produces meaningless similarity scores, so a mismatch is checked at
 * retrieval time rather than assumed.
 */
export function resolveEmbedder(): Embedder {
  // Phase 4 ships the deterministic embedder only. Wiring the OpenAI embedder
  // means re-embedding the corpus, which belongs with Phase 7 ingestion.
  return deterministicEmbedder;
}

export { fakeProvider };
export type { GuidanceProvider };
