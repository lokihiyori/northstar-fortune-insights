"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { recordEvent } from "@/features/analytics/events";

import { FEEDBACK_TAGS } from "./feedback-tags";

const RATINGS = ["USEFUL", "PARTLY_USEFUL", "NOT_USEFUL"] as const;
type Rating = (typeof RATINGS)[number];

export async function submitFeedback(formData: FormData): Promise<void> {
  const user = await requireUser("/app");
  const reportId = String(formData.get("reportId") ?? "");
  const rating = String(formData.get("rating") ?? "");
  const comment = String(formData.get("comment") ?? "").trim();

  if (!RATINGS.includes(rating as Rating)) return;

  // Ownership re-checked here rather than trusted from the form.
  const report = await prisma.guidanceReport.findFirst({
    where: { id: reportId, userId: user.id, deletedAt: null },
    select: { id: true },
  });
  if (!report) return;

  const tags = FEEDBACK_TAGS.filter((tag) => formData.get(`tag:${tag}`) === "on");

  await prisma.feedback.upsert({
    where: { userId_reportId: { userId: user.id, reportId: report.id } },
    update: { rating: rating as Rating, tags, comment: comment || null },
    create: {
      userId: user.id,
      reportId: report.id,
      rating: rating as Rating,
      tags,
      comment: comment || null,
    },
  });

  // The rating and tags are analysable; the free-text comment never becomes an
  // event property.
  await recordEvent("report_feedback_submitted", user.id, { rating, tagCount: tags.length });

  revalidatePath(`/app/insights/${report.id}`);
}
