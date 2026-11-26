import { z } from "zod";

/**
 * Project contracts (P2-10). Requests are .strict(): unknown fields — including any attempt to pass
 * org_id/orgId — are rejected; the org always comes from the session (CLAUDE.md §9).
 */
export const ProjectSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "slug: 2-63 chars, lowercase letters, digits and '-'");

const name = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().min(1, "name is required").max(120, "name: at most 120 characters"));
const description = z.string().max(2000, "description: at most 2000 characters");

export const ProjectCreateSchema = z
  .object({
    slug: ProjectSlugSchema,
    name,
    description: description.optional(),
  })
  .strict();

export const ProjectUpdateSchema = z
  .object({
    name: name.optional(),
    description: description.nullable().optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.description !== undefined, "nothing to update");

export const ProjectSchema = z
  .object({
    slug: ProjectSlugSchema,
    name: z.string(),
    description: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().nullable(),
  })
  .strict();

export const ProjectListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    archived: z.enum(["true", "false"]).default("false"),
  })
  .strict();

export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;
export type Project = z.infer<typeof ProjectSchema>;
