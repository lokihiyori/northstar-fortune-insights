"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireUser } from "@/features/auth/guards";
import { recordEvent } from "@/features/analytics/events";
import { getEntitlements } from "@/features/billing/entitlements";
import { prisma } from "@/lib/db/prisma";
import { enforceAction } from "@/lib/rate-limit/enforce";
import { runGuidancePipeline } from "./orchestrator";
import { countReportsThisPeriod, recordReportUsage } from "./usage";
import type { GuidanceInput } from "./rules/types";

export async function archiveReport(formData: FormData): Promise<void> {
  const user = await requireUser("/app/history");
  const reportId = String(formData.get("reportId") ?? "");
  const restore = formData.get("restore") === "true";

  const report = await prisma.guidanceReport.findFirst({
    where: { id: reportId, userId: user.id, deletedAt: null },
    select: { id: true },
  });
  if (!report) return;

  await prisma.guidanceReport.update({
    where: { id: report.id },
    data: { archivedAt: restore ? null : new Date() },
  });

  if (!restore) await recordEvent("report_archived", user.id);

  revalidatePath("/app/history");
  revalidatePath("/app");
}

/**
 * Regenerates a report as a new version (spec section 5.5).
 *
 * The original version is never overwritten — both stay in history so the user
 * can see what changed after updating their assumptions. Re-running the full
 * pipeline costs a report from the allowance, which the pricing page states.
 */
export async function regenerateReport(formData: FormData): Promise<void> {
  const user = await requireUser("/app/history");
  const reportId = String(formData.get("reportId") ?? "");

  const report = await prisma.guidanceReport.findFirst({
    where: { id: reportId, userId: user.id, deletedAt: null },
    select: { id: true, requestId: true, request: { select: { inputSnapshot: true } } },
  });
  if (!report) redirect("/app/history");

  // Regeneration re-runs the entire pipeline at full cost, so it carries its
  // own ceiling. Surfaced the same way a refused allowance already is, rather
  // than as an error screen.
  const limited = await enforceAction("regeneration", {
    headers: await headers(),
    userId: user.id,
  });
  if (limited) {
    redirect(`/app/insights/${report.id}?error=rate-limited`);
  }

  const [entitlements, used] = await Promise.all([
    getEntitlements(user.id),
    countReportsThisPeriod(user.id),
  ]);
  if (used >= entitlements.monthlyReports) {
    redirect(`/app/insights/${report.id}?error=allowance`);
  }

  await prisma.guidanceRequest.update({
    where: { id: report.requestId },
    data: { status: "PENDING", stageIndex: 0, errorCode: null, errorMessage: null },
  });

  // The stored snapshot is replayed, so the new version differs only by what
  // the engine produced, not by a silently changed input.
  const input = report.request.inputSnapshot as unknown as GuidanceInput;

  await recordEvent("report_regenerated", user.id);

  after(async () => {
    const result = await runGuidancePipeline(report.requestId, input);
    if (result.ok) await recordReportUsage(user.id, `${report.requestId}:v${String(Date.now())}`);
  });

  redirect(`/app/ask/${report.requestId}`);
}
