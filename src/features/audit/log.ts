import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { AuditAction } from "@/generated/prisma/enums";

/**
 * Append-only audit trail (spec section 12: audit every source/prompt change).
 *
 * There is deliberately no update or delete helper. An audit record that the
 * application can rewrite is not evidence of anything.
 */

/** Primitives only, so a whole entity — with secrets — cannot be logged by accident. */
export type AuditMetadata = Record<string, string | number | boolean | null>;

/**
 * Field names that must never reach audit metadata. Auditing *that* a field
 * changed is useful; recording the value can leak a secret or personal data.
 */
const FORBIDDEN_KEYS =
  /password|secret|token|apikey|api_key|authorization|cookie|prompt|embedding|email/i;

function sanitize(metadata: AuditMetadata): AuditMetadata {
  const safe: AuditMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_KEYS.test(key)) continue;
    // Long free text is truncated: an audit row is a record of an action, not a
    // copy of the content.
    safe[key] = typeof value === "string" ? value.slice(0, 300) : value;
  }
  return safe;
}

export type AuditActor = {
  id: string;
  /** Stored denormalized so history stays readable after account deletion. */
  email: string;
};

export async function writeAuditLog(args: {
  actor: AuditActor;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata?: AuditMetadata;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: args.actor.id,
      actorEmail: args.actor.email,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      metadata: sanitize(args.metadata ?? {}) as object,
    },
  });
}

export async function listAuditLogsForEntity(entityType: string, entityId: string, take = 50) {
  return prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      action: true,
      actorEmail: true,
      metadata: true,
      createdAt: true,
    },
  });
}

export async function listRecentAuditLogs(take = 20) {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      action: true,
      actorEmail: true,
      entityType: true,
      entityId: true,
      createdAt: true,
    },
  });
}
