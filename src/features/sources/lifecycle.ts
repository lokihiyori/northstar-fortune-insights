import { z } from "zod";
import type { SourceStatus } from "@/generated/prisma/enums";

/**
 * Source lifecycle: Draft → Reviewed → Published → Retired (spec section 5.8).
 *
 * Encoded as pure functions so the rules are testable without a database and
 * identical wherever they are enforced — the UI disables the buttons, and the
 * server refuses the transition regardless.
 */
export const TRANSITIONS: Record<SourceStatus, readonly SourceStatus[]> = {
  // A draft may be reviewed, or retired if it turns out to be unusable.
  DRAFT: ["REVIEWED", "RETIRED"],
  // Review can be revoked back to draft if the metadata needs more work.
  REVIEWED: ["PUBLISHED", "DRAFT", "RETIRED"],
  // Publishing is reversible only by retiring — never silently back to draft,
  // because reports may already cite it.
  PUBLISHED: ["RETIRED"],
  // A retired source can be reinstated for review, but never straight back to
  // published without re-review.
  RETIRED: ["REVIEWED"],
};

export const STATUS_COPY: Record<SourceStatus, string> = {
  DRAFT: "Draft",
  REVIEWED: "Reviewed",
  PUBLISHED: "Published",
  RETIRED: "Retired",
};

export const STATUS_DESCRIPTION: Record<SourceStatus, string> = {
  DRAFT: "Being prepared. Not retrievable.",
  REVIEWED: "Checked by a person. Not yet retrievable.",
  PUBLISHED: "Retrievable by the guidance engine.",
  RETIRED: "Excluded from new reports. Still resolvable for reports that cited it.",
};

export function canTransition(from: SourceStatus, to: SourceStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

/**
 * Metadata every published source must carry.
 *
 * `summary` is deliberately **not** nullable here even though the column is:
 * a source may be drafted without one, but the resource library shows it to
 * users as the reason a source is relevant, so publishing without it would
 * leave a visible blank.
 */
export const publishableMetadataSchema = z.object({
  title: z.string().trim().min(3),
  publisher: z.string().trim().min(2),
  region: z.string().trim().min(2),
  canonicalUrl: z.string().trim().url(),
  summary: z.string().trim().min(10),
});

export type PublishReadiness = {
  status: SourceStatus;
  title: string;
  publisher: string;
  region: string;
  canonicalUrl: string;
  summary: string | null;
  chunkCount: number;
  embeddedChunkCount: number;
};

/**
 * Publishing is the only transition that makes a source visible to users, so it
 * carries the extra bar: complete metadata *and* processed, embedded chunks. A
 * published source with no embeddings is invisible to retrieval — it would look
 * live while contributing nothing.
 */
export function checkPublishable(source: PublishReadiness): TransitionCheck {
  if (!canTransition(source.status, "PUBLISHED")) {
    return {
      ok: false,
      reason: `A ${STATUS_COPY[source.status].toLowerCase()} source cannot be published directly. It must be reviewed first.`,
    };
  }

  const metadata = publishableMetadataSchema.safeParse({
    title: source.title,
    publisher: source.publisher,
    region: source.region,
    canonicalUrl: source.canonicalUrl,
    summary: source.summary,
  });

  if (!metadata.success) {
    return {
      ok: false,
      reason:
        "Required metadata is incomplete. Title, publisher, region, canonical URL, and a summary are needed before publishing.",
    };
  }

  if (source.chunkCount === 0) {
    return { ok: false, reason: "This source has no ingested content yet." };
  }

  if (source.embeddedChunkCount < source.chunkCount) {
    return {
      ok: false,
      reason: "Some passages are not embedded yet, so the source would be invisible to retrieval.",
    };
  }

  return { ok: true };
}

export function checkTransition(from: SourceStatus, to: SourceStatus): TransitionCheck {
  if (canTransition(from, to)) return { ok: true };

  return {
    ok: false,
    reason: `Cannot move a ${STATUS_COPY[from].toLowerCase()} source to ${STATUS_COPY[to].toLowerCase()}.`,
  };
}

/** Only published sources are retrievable — the invariant retrieval depends on. */
export function isRetrievable(status: SourceStatus, deletedAt: Date | null): boolean {
  return status === "PUBLISHED" && deletedAt === null;
}
