import "server-only";

import { prisma } from "@/lib/db/prisma";
import { currentPeriodKey } from "@/features/billing/entitlements";

export const REPORT_FEATURE = "guidance_report";

/** Reports consumed in the current period. Counted server-side, never trusted from the client. */
export async function countReportsThisPeriod(userId: string): Promise<number> {
  const result = await prisma.usageLedger.aggregate({
    where: { userId, feature: REPORT_FEATURE, periodKey: currentPeriodKey() },
    _sum: { units: true },
  });
  return result._sum.units ?? 0;
}

/**
 * Records consumption for a request.
 *
 * The unique constraint on (userId, requestId, feature) makes this idempotent:
 * a retried pipeline for the same request can never double-charge. Usage is only
 * recorded on success, so a failed generation costs the user nothing — which is
 * what the pricing page promises.
 */
export async function recordReportUsage(userId: string, requestId: string): Promise<void> {
  await prisma.usageLedger.upsert({
    where: { userId_requestId_feature: { userId, requestId, feature: REPORT_FEATURE } },
    update: {},
    create: {
      userId,
      requestId,
      feature: REPORT_FEATURE,
      units: 1,
      periodKey: currentPeriodKey(),
    },
  });
}
