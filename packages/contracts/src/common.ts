import { z } from "zod";

/** Shared building blocks for org-scoped entities (projects, provider accounts, workers…). */
export const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "slug: 2-63 chars, lowercase letters, digits and '-'");

export const NameSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().min(1, "name is required").max(120, "name: at most 120 characters"));

export const DescriptionSchema = z.string().max(2000, "description: at most 2000 characters");

export const ListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    archived: z.enum(["true", "false"]).default("false"),
  })
  .strict();
