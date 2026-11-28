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

export const ProjectMemberAccessSchema = z.enum(["read", "write"]);
export type ProjectMemberAccess = z.infer<typeof ProjectMemberAccessSchema>;

export const ProjectMemberSchema = z
  .object({
    githubUserId: z.number().int().positive(),
    githubLogin: z.string().nullable(),
    access: ProjectMemberAccessSchema,
    createdAt: z.string(),
  })
  .strict();

export const ProjectMemberAssignSchema = z
  .object({
    githubUserId: z.number().int().positive(),
    access: ProjectMemberAccessSchema,
  })
  .strict();

export const ProjectMemberUnassignSchema = z
  .object({
    githubUserId: z.number().int().positive(),
  })
  .strict();

export const ProjectMemberResultSchema = z
  .object({
    changed: z.boolean(),
  })
  .strict();

export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectMember = z.infer<typeof ProjectMemberSchema>;
export type ProjectMemberAssign = z.infer<typeof ProjectMemberAssignSchema>;
export type ProjectMemberUnassign = z.infer<typeof ProjectMemberUnassignSchema>;
export type ProjectMemberResult = z.infer<typeof ProjectMemberResultSchema>;

export const ProjectStatsCountsSchema = z
  .object({
    BACKLOG: z.number().int().min(0),
    TODO: z.number().int().min(0),
    IN_PROGRESS: z.number().int().min(0),
    IN_REVIEW: z.number().int().min(0),
    DONE: z.number().int().min(0),
    CANCELLED: z.number().int().min(0),
  })
  .strict();

export type ProjectStatsCounts = z.infer<typeof ProjectStatsCountsSchema>;

export const ProjectStatsItemSchema = z
  .object({
    projectSlug: z.string(),
    projectName: z.string(),
    counts: ProjectStatsCountsSchema,
    total: z.number().int().min(0),
  })
  .strict();

export type ProjectStatsItem = z.infer<typeof ProjectStatsItemSchema>;

export const ProjectStatsResponseSchema = z
  .object({
    items: z.array(ProjectStatsItemSchema),
  })
  .strict();

export type ProjectStatsResponse = z.infer<typeof ProjectStatsResponseSchema>;

export const ProjectStatsQuerySchema = z
  .object({
    archived: z.enum(["true", "false"]).default("false"),
    includeArchived: z.enum(["true", "false"]).optional(),
  })
  .strict();

export type ProjectStatsQuery = z.infer<typeof ProjectStatsQuerySchema>;

