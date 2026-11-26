import { z } from "zod";
import { DescriptionSchema, ListQuerySchema, NameSchema, SlugSchema } from "./common";

/**
 * Project contracts (P2-10). Requests are .strict(): unknown fields — including any attempt to pass
 * org_id/orgId — are rejected; the org always comes from the session (CLAUDE.md §9).
 */
export const ProjectSlugSchema = SlugSchema;
const name = NameSchema;
const description = DescriptionSchema;

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

export const ProjectListQuerySchema = ListQuerySchema;

export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;
export type Project = z.infer<typeof ProjectSchema>;
