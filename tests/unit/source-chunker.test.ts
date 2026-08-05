import { describe, expect, it } from "vitest";
import {
  MAX_CHUNK_CHARS,
  checksumFor,
  chunkContent,
  chunksUnchanged,
} from "@/features/sources/chunker";

const TWO_PARAGRAPHS = `Job Bank publishes employment outlook ratings by occupation and province, describing whether prospects are limited, fair, good, or very good.

Wage data is reported as low, median, and high figures for each occupation in each region, and the median is usually the better anchor for planning.`;

describe("chunkContent", () => {
  it("splits on paragraph boundaries", () => {
    const chunks = chunkContent(TWO_PARAGRAPHS);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toContain("outlook ratings");
    expect(chunks[1]?.text).toContain("Wage data");
  });

  it("numbers positions from zero, contiguously", () => {
    const chunks = chunkContent(TWO_PARAGRAPHS);
    expect(chunks.map((chunk) => chunk.position)).toEqual([0, 1]);
  });

  it("is deterministic — identical input yields identical chunks and checksums", () => {
    expect(JSON.stringify(chunkContent(TWO_PARAGRAPHS))).toBe(
      JSON.stringify(chunkContent(TWO_PARAGRAPHS)),
    );
  });

  it("returns nothing for empty or whitespace-only content", () => {
    for (const input of ["", "   ", "\n\n\t\n"]) {
      expect(chunkContent(input)).toEqual([]);
    }
  });

  it("never emits a chunk longer than the maximum", () => {
    const long = `${"word ".repeat(2000)}`;
    for (const chunk of chunkContent(long)) {
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });

  it("splits an over-long paragraph on sentence boundaries where it can", () => {
    const sentences = Array.from(
      { length: 40 },
      (_, index) => `This is sentence number ${String(index)} and it carries some meaning.`,
    ).join(" ");

    const chunks = chunkContent(sentences);
    expect(chunks.length).toBeGreaterThan(1);
    // Sentence-boundary splitting should not cut mid-word.
    for (const chunk of chunks) {
      expect(chunk.text).not.toMatch(/\bsentenc$|\bnumbe$/);
    }
  });

  it("merges a stray short fragment into the previous chunk", () => {
    const withHeading = `${TWO_PARAGRAPHS}\n\nNote.`;
    const chunks = chunkContent(withHeading);
    // "Note." is below the minimum, so it must not become its own passage.
    expect(chunks.every((chunk) => chunk.text !== "Note.")).toBe(true);
  });

  it("normalizes whitespace so reformatting is not a content change", () => {
    const spaced = TWO_PARAGRAPHS.replace(/ /g, "  ");
    expect(chunkContent(spaced).map((c) => c.checksum)).toEqual(
      chunkContent(TWO_PARAGRAPHS).map((c) => c.checksum),
    );
  });

  it("changes the checksum when the text actually changes", () => {
    const edited = TWO_PARAGRAPHS.replace("very good", "excellent");
    expect(chunkContent(edited)[0]?.checksum).not.toBe(chunkContent(TWO_PARAGRAPHS)[0]?.checksum);
  });
});

describe("checksumFor", () => {
  it("is stable and fixed-width", () => {
    const a = checksumFor("some passage text");
    expect(a).toBe(checksumFor("some passage text"));
    expect(a).toHaveLength(32);
  });

  it("differs for different content", () => {
    expect(checksumFor("a")).not.toBe(checksumFor("b"));
  });
});

describe("chunksUnchanged", () => {
  it("detects that re-ingesting identical content is a no-op", () => {
    const chunks = chunkContent(TWO_PARAGRAPHS);
    expect(chunksUnchanged(chunks, chunks)).toBe(true);
  });

  it("detects edited content", () => {
    const before = chunkContent(TWO_PARAGRAPHS);
    const after = chunkContent(TWO_PARAGRAPHS.replace("median", "average"));
    expect(chunksUnchanged(before, after)).toBe(false);
  });

  it("detects a changed number of passages", () => {
    const before = chunkContent(TWO_PARAGRAPHS);
    const after = chunkContent(
      `${TWO_PARAGRAPHS}\n\nA third paragraph with enough length to count.`,
    );
    expect(chunksUnchanged(before, after)).toBe(false);
  });
});
