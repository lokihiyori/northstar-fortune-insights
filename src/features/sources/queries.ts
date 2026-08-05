import "server-only";

import { prisma } from "@/lib/db/prisma";

/** Admin read models. Every caller is behind `requireAdmin`. */
export async function listSourcesForAdmin() {
  const sources = await prisma.source.findMany({
    where: { deletedAt: null },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      publisher: true,
      region: true,
      topic: true,
      status: true,
      canonicalUrl: true,
      reviewedAt: true,
      publishedAt: true,
      updatedAt: true,
      _count: { select: { chunks: true, citations: true } },
    },
  });

  return sources;
}

export async function getSourceForAdmin(id: string) {
  return prisma.source.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      title: true,
      publisher: true,
      region: true,
      topic: true,
      status: true,
      canonicalUrl: true,
      summary: true,
      reviewedAt: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
      chunks: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, text: true, checksum: true, embeddingModel: true },
      },
      _count: { select: { citations: true } },
    },
  });
}

/** Counts for the admin landing page. */
export async function sourceStatusCounts() {
  const grouped = await prisma.source.groupBy({
    by: ["status"],
    where: { deletedAt: null },
    _count: { _all: true },
  });

  const counts = { DRAFT: 0, REVIEWED: 0, PUBLISHED: 0, RETIRED: 0 };
  for (const row of grouped) {
    counts[row.status] = row._count._all;
  }
  return counts;
}

/**
 * Finds an existing source by canonical URL, including soft-deleted rows —
 * a duplicate check that ignored them would let a second record be created for
 * a URL that is already taken by the unique constraint.
 */
export async function findByCanonicalUrl(canonicalUrl: string) {
  return prisma.source.findUnique({
    where: { canonicalUrl },
    select: { id: true, title: true, status: true, deletedAt: true },
  });
}
