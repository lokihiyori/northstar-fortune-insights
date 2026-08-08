import "server-only";

import { writeAuditLog, type AuditActor } from "@/features/audit/log";
import { invalidateRetrievalCache } from "@/features/retrieval/cache";
import { logFailure } from "@/lib/observability/logger";
import { captureException } from "@/lib/observability/monitoring";
import { prisma } from "@/lib/db/prisma";
import { canonicalizeUrl } from "./canonicalize";
import { chunkStats, ingestSourceContent } from "./ingest";
import { checkPublishable, checkTransition } from "./lifecycle";
import type { CreateSourceInput, SourceMetadataInput } from "./validation";
import type { SourceStatus } from "@/generated/prisma/enums";

/**
 * Source lifecycle operations.
 *
 * Every mutation that changes what the guidance engine can retrieve does three
 * things together: apply the change, write an audit record, and invalidate the
 * retrieval cache. Keeping them in one place is what stops a future caller from
 * publishing a source and leaving a stale cache serving the old corpus.
 */
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export async function createSource(
  actor: AuditActor,
  input: CreateSourceInput,
): Promise<ServiceResult<{ id: string }>> {
  const canonical = canonicalizeUrl(input.canonicalUrl);
  if (!canonical.ok) return { ok: false, reason: canonical.reason };

  // Checked explicitly so the admin gets a useful message naming the existing
  // source, rather than a raw unique-constraint violation.
  const existing = await prisma.source.findUnique({
    where: { canonicalUrl: canonical.url },
    select: { id: true, title: true },
  });
  if (existing) {
    return {
      ok: false,
      reason: `That URL is already registered as "${existing.title}". Edit the existing source instead.`,
    };
  }

  const source = await prisma.source.create({
    data: {
      title: input.title,
      publisher: input.publisher,
      region: input.region,
      topic: input.topic,
      canonicalUrl: canonical.url,
      summary: input.summary ?? null,
      status: "DRAFT",
    },
    select: { id: true },
  });

  await writeAuditLog({
    actor,
    action: "SOURCE_CREATED",
    entityType: "Source",
    entityId: source.id,
    metadata: { title: input.title, topic: input.topic, region: input.region },
  });

  if (input.content) {
    const ingested = await ingest(actor, source.id, input.content);
    if (!ingested.ok) return ingested;
  }

  // A new source is a DRAFT and therefore not retrievable, so no cache change.
  return { ok: true, value: { id: source.id } };
}

export async function updateSourceMetadata(
  actor: AuditActor,
  sourceId: string,
  input: SourceMetadataInput,
): Promise<ServiceResult<{ id: string }>> {
  const canonical = canonicalizeUrl(input.canonicalUrl);
  if (!canonical.ok) return { ok: false, reason: canonical.reason };

  const current = await prisma.source.findFirst({
    where: { id: sourceId, deletedAt: null },
    select: { id: true, status: true, canonicalUrl: true, title: true },
  });
  if (!current) return { ok: false, reason: "That source no longer exists." };

  if (canonical.url !== current.canonicalUrl) {
    const clash = await prisma.source.findUnique({
      where: { canonicalUrl: canonical.url },
      select: { id: true, title: true },
    });
    if (clash && clash.id !== sourceId) {
      return { ok: false, reason: `That URL already belongs to "${clash.title}".` };
    }
  }

  await prisma.source.update({
    where: { id: sourceId },
    data: {
      title: input.title,
      publisher: input.publisher,
      region: input.region,
      topic: input.topic,
      canonicalUrl: canonical.url,
      summary: input.summary ?? null,
    },
  });

  await writeAuditLog({
    actor,
    action: "SOURCE_UPDATED",
    entityType: "Source",
    entityId: sourceId,
    metadata: {
      title: input.title,
      topic: input.topic,
      region: input.region,
      urlChanged: canonical.url !== current.canonicalUrl,
    },
  });

  // Editing a live source changes what retrieval returns, so the cache must go.
  if (current.status === "PUBLISHED") await invalidateRetrievalCache();

  return { ok: true, value: { id: sourceId } };
}

export async function ingest(
  actor: AuditActor,
  sourceId: string,
  content: string,
): Promise<ServiceResult<{ chunkCount: number }>> {
  const source = await prisma.source.findFirst({
    where: { id: sourceId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!source) return { ok: false, reason: "That source no longer exists." };

  try {
    const result = await ingestSourceContent(sourceId, content);

    await writeAuditLog({
      actor,
      action: "SOURCE_INGESTED",
      entityType: "Source",
      entityId: sourceId,
      // Counts only — the passage text itself is never copied into the audit row.
      metadata: {
        chunkCount: result.chunkCount,
        embeddedCount: result.embeddedCount,
        skipped: result.skipped,
      },
    });

    if (source.status === "PUBLISHED" && !result.skipped) await invalidateRetrievalCache();

    return { ok: true, value: { chunkCount: result.chunkCount } };
  } catch (error) {
    // The source id is safe; the content being ingested never is.
    logFailure("source.ingested", "internal", { sourceId, outcome: "failed" });
    captureException(error, { category: "internal", fields: { sourceId } });
    return { ok: false, reason: "That content could not be ingested." };
  }
}

export async function transitionSource(
  actor: AuditActor,
  sourceId: string,
  to: SourceStatus,
): Promise<ServiceResult<{ status: SourceStatus }>> {
  const source = await prisma.source.findFirst({
    where: { id: sourceId, deletedAt: null },
    select: {
      id: true,
      status: true,
      title: true,
      publisher: true,
      region: true,
      canonicalUrl: true,
      summary: true,
    },
  });
  if (!source) return { ok: false, reason: "That source no longer exists." };

  const from = source.status;

  if (to === "PUBLISHED") {
    // The stricter gate: complete metadata and fully embedded content.
    const stats = await chunkStats(sourceId);
    const readiness = checkPublishable({
      status: from,
      title: source.title,
      publisher: source.publisher,
      region: source.region,
      canonicalUrl: source.canonicalUrl,
      summary: source.summary,
      chunkCount: stats.total,
      embeddedChunkCount: stats.embedded,
    });
    if (!readiness.ok) return { ok: false, reason: readiness.reason };
  } else {
    const allowed = checkTransition(from, to);
    if (!allowed.ok) return { ok: false, reason: allowed.reason };
  }

  await prisma.source.update({
    where: { id: sourceId },
    data: {
      status: to,
      // Timestamps are set, never cleared: when a source was first reviewed or
      // published stays true even after it is retired.
      ...(to === "REVIEWED" ? { reviewedAt: new Date() } : {}),
      ...(to === "PUBLISHED" ? { publishedAt: new Date() } : {}),
    },
  });

  await writeAuditLog({
    actor,
    action: auditActionFor(from, to),
    entityType: "Source",
    entityId: sourceId,
    metadata: { from, to, title: source.title },
  });

  // Publishing adds to the retrievable corpus; retiring removes from it. Either
  // way every cached result is now potentially wrong.
  //
  // Verified by tests/integration/retrieval-cache.test.ts: removing this line
  // makes that test fail, because the warm entry keeps serving the retired
  // source.
  if (to === "PUBLISHED" || from === "PUBLISHED") await invalidateRetrievalCache();

  return { ok: true, value: { status: to } };
}

function auditActionFor(from: SourceStatus, to: SourceStatus) {
  if (to === "REVIEWED") return from === "RETIRED" ? "SOURCE_REINSTATED" : "SOURCE_REVIEWED";
  if (to === "PUBLISHED") return "SOURCE_PUBLISHED";
  if (to === "RETIRED") return "SOURCE_RETIRED";
  return "SOURCE_UPDATED";
}
