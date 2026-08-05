import { createHash } from "node:crypto";

export const EMBEDDING_DIMENSIONS = 1536;

export type Embedder = {
  /** Recorded on every chunk so a model change can be detected and re-embedded. */
  readonly model: string;
  embed: (texts: string[]) => Promise<number[][]>;
};

/**
 * Deterministic offline embedder.
 *
 * Not a mock standing in for a real call — it is a genuine, if crude, embedding:
 * hashed token features projected into a fixed-width unit vector. Similar text
 * yields similar vectors, so retrieval is meaningfully exercised in development,
 * tests, and CI with no provider, no key, and no cost.
 *
 * It is deliberately weaker than a learned model. Its purpose is to make the
 * pipeline runnable and testable offline, not to match production recall.
 */
export const deterministicEmbedder: Embedder = {
  model: "northstar-deterministic-v1",
  embed: (texts) => Promise.resolve(texts.map(embedOne)),
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function embedOne(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = tokenize(text);

  for (const token of tokens) {
    // Two hashed positions per token keeps collisions from dominating.
    const digest = createHash("sha256").update(token).digest();
    for (let slot = 0; slot < 2; slot += 1) {
      const offset = slot * 4;
      const index = digest.readUInt32BE(offset) % EMBEDDING_DIMENSIONS;
      const sign = (digest[offset + 4] ?? 0) % 2 === 0 ? 1 : -1;
      vector[index] = (vector[index] ?? 0) + sign;
    }
  }

  return normalize(vector);
}

function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  // A chunk with no usable tokens would otherwise divide by zero.
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

/** pgvector literal form: `[0.1,0.2,...]`. */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}
