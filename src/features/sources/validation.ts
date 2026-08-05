import { z } from "zod";

export const TOPIC_VALUES = ["CAREER", "EDUCATION", "RELOCATION", "PERSONAL_GOAL"] as const;

export const sourceMetadataSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters.").max(200),
  publisher: z.string().trim().min(2, "Publisher is required.").max(160),
  region: z.string().trim().min(2, "Region is required.").max(120),
  topic: z.enum(TOPIC_VALUES),
  canonicalUrl: z.string().trim().min(1, "Canonical URL is required."),
  summary: z
    .string()
    .trim()
    .max(1000)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional(),
});

export const createSourceSchema = sourceMetadataSchema.extend({
  /** Optional at creation: a source can be drafted before content is available. */
  content: z
    .string()
    .trim()
    .max(200_000, "That content is too large to ingest in one go.")
    .optional(),
});

export const ingestContentSchema = z.object({
  content: z
    .string()
    .trim()
    .min(40, "There is not enough content to produce a usable passage.")
    .max(200_000, "That content is too large to ingest in one go."),
});

export type SourceMetadataInput = z.infer<typeof sourceMetadataSchema>;
export type CreateSourceInput = z.infer<typeof createSourceSchema>;
