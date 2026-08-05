"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/features/auth/guards";
import { createSource, ingest, transitionSource, updateSourceMetadata } from "./service";
import { createSourceSchema, ingestContentSchema, sourceMetadataSchema } from "./validation";
import type { SourceStatus } from "@/generated/prisma/enums";

/**
 * Admin server actions.
 *
 * Each calls `requireAdmin` itself. The layout guard makes the pages
 * unreachable, but a server action is independently invocable — it is its own
 * entry point and must carry its own check.
 */
export type AdminFormState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
};

function read(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const result: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "_";
    (result[key] ??= []).push(issue.message);
  }
  return result;
}

const METADATA_KEYS = ["title", "publisher", "region", "topic", "canonicalUrl", "summary"] as const;

function metadataValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(METADATA_KEYS.map((key) => [key, read(formData, key)]));
}

export async function createSourceAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const admin = await requireAdmin("/admin/sources");
  const values = { ...metadataValues(formData), content: read(formData, "content") };

  const parsed = createSourceSchema.safeParse({
    ...metadataValues(formData),
    content: read(formData, "content") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
      values,
    };
  }

  const result = await createSource({ id: admin.id, email: admin.email }, parsed.data);
  if (!result.ok) {
    return { status: "error", message: result.reason, values };
  }

  revalidatePath("/admin/sources");
  redirect(`/admin/sources/${result.value.id}`);
}

export async function updateSourceAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const admin = await requireAdmin("/admin/sources");
  const sourceId = read(formData, "sourceId");
  const values = metadataValues(formData);

  const parsed = sourceMetadataSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
      values,
    };
  }

  const result = await updateSourceMetadata(
    { id: admin.id, email: admin.email },
    sourceId,
    parsed.data,
  );
  if (!result.ok) return { status: "error", message: result.reason, values };

  revalidatePath(`/admin/sources/${sourceId}`);
  revalidatePath("/admin/sources");
  return { status: "idle", message: "Saved." };
}

export async function ingestContentAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const admin = await requireAdmin("/admin/sources");
  const sourceId = read(formData, "sourceId");
  const content = read(formData, "content");

  const parsed = ingestContentSchema.safeParse({ content });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "That content could not be ingested.",
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
    };
  }

  const result = await ingest({ id: admin.id, email: admin.email }, sourceId, parsed.data.content);
  if (!result.ok) return { status: "error", message: result.reason };

  revalidatePath(`/admin/sources/${sourceId}`);
  return { status: "idle", message: `Ingested ${String(result.value.chunkCount)} passages.` };
}

export async function transitionSourceAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin("/admin/sources");
  const sourceId = read(formData, "sourceId");
  const to = read(formData, "to") as SourceStatus;

  const allowed: SourceStatus[] = ["DRAFT", "REVIEWED", "PUBLISHED", "RETIRED"];
  if (!allowed.includes(to)) return;

  const result = await transitionSource({ id: admin.id, email: admin.email }, sourceId, to);

  revalidatePath(`/admin/sources/${sourceId}`);
  revalidatePath("/admin/sources");
  revalidatePath("/admin");

  if (!result.ok) {
    // Surfaced on the page rather than thrown, so a refused transition reads as
    // a validation message instead of an error screen.
    redirect(`/admin/sources/${sourceId}?error=${encodeURIComponent(result.reason)}`);
  }
}
