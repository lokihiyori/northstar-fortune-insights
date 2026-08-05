import { createHash } from "node:crypto";

/**
 * Deterministic chunking.
 *
 * Retrieval matches passages, not documents: one long blob would return the
 * same chunk for every question. Splitting on paragraph boundaries keeps each
 * chunk a coherent unit of meaning, which is what makes a citation quotable.
 *
 * Determinism matters beyond tidiness — the same input must always produce the
 * same chunks and checksums, so re-ingesting unchanged content is a no-op and a
 * changed upstream document is detectable.
 */
export const MAX_CHUNK_CHARS = 1_200;
export const MIN_CHUNK_CHARS = 40;

export type Chunk = {
  position: number;
  text: string;
  checksum: string;
};

export function checksumFor(text: string): string {
  // Hashes the normalized text, so a whitespace-only edit upstream does not
  // look like a content change.
  return createHash("sha256").update(normalizeWhitespace(text)).digest("hex").slice(0, 32);
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Splits an over-long paragraph on sentence boundaries, never mid-word. */
function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= MAX_CHUNK_CHARS) return [paragraph];

  const sentences = paragraph.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [paragraph];
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current}${sentence}` : sentence;

    if (candidate.trim().length > MAX_CHUNK_CHARS && current) {
      parts.push(current.trim());
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) parts.push(current.trim());

  // A single sentence longer than the limit still has to be split somewhere;
  // a hard cut is preferable to emitting an oversized chunk.
  return parts.flatMap((part) =>
    part.length <= MAX_CHUNK_CHARS ? [part] : hardSplit(part, MAX_CHUNK_CHARS),
  );
}

function hardSplit(text: string, size: number): string[] {
  const parts: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    parts.push(text.slice(index, index + size).trim());
  }
  return parts.filter(Boolean);
}

export function chunkContent(content: string): Chunk[] {
  const normalized = normalizeWhitespace(content);
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
    .filter(Boolean);

  const pieces = paragraphs.flatMap(splitLongParagraph);

  // Very short fragments — a stray heading or caption — carry no retrievable
  // meaning on their own, so they are merged into the previous chunk.
  const merged: string[] = [];
  for (const piece of pieces) {
    const previous = merged[merged.length - 1];
    if (
      piece.length < MIN_CHUNK_CHARS &&
      previous &&
      previous.length + piece.length <= MAX_CHUNK_CHARS
    ) {
      merged[merged.length - 1] = `${previous} ${piece}`;
    } else {
      merged.push(piece);
    }
  }

  return merged
    .filter((text) => text.length >= MIN_CHUNK_CHARS || merged.length === 1)
    .map((text, position) => ({ position, text, checksum: checksumFor(text) }));
}

/** True when stored chunks already match the content, so re-embedding is wasted work. */
export function chunksUnchanged(
  existing: readonly { checksum: string }[],
  next: readonly Chunk[],
): boolean {
  if (existing.length !== next.length) return false;
  return existing.every((chunk, index) => chunk.checksum === next[index]?.checksum);
}
