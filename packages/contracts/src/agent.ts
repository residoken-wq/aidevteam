import { z } from "zod";
import { DescriptionSchema, ListQuerySchema, NameSchema, SlugSchema } from "./common";

/**
 * P2-05 agents (org chart). The data model is a Release 0.1 proposal (Master Plan SOURCE_MISSING).
 * `model` is a free identifier (no hard-coded catalogue of provider models); only a safe charset is enforced.
 * Provider account and manager are referenced by slug and resolved inside the session's org only.
 */
export const AgentModelSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/, "model: 1-100 chars, letters, digits and . _ : / @ -");

export const AgentTitleSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().min(1, "title must not be blank").max(120, "title: at most 120 characters"));

export const AgentCapabilitiesSchema = z
  .array(SlugSchema)
  .max(20, "capabilities: at most 20 tags")
  .refine((items) => new Set(items).size === items.length, {
    message: "capabilities: duplicate tags are not allowed",
  });

export const AgentMaxActiveTasksSchema = z
  .number()
  .int()
  .min(1, "maxActiveTasks must be between 1 and 50")
  .max(50, "maxActiveTasks must be between 1 and 50");

export const AgentCreateSchema = z
  .object({
    slug: SlugSchema,
    name: NameSchema,
    title: AgentTitleSchema.optional(),
    model: AgentModelSchema.optional(),
    providerAccountSlug: SlugSchema.optional(),
    reportsToSlug: SlugSchema.optional(),
    description: DescriptionSchema.optional(),
    capabilities: AgentCapabilitiesSchema.optional(),
    maxActiveTasks: AgentMaxActiveTasksSchema.optional(),
  })
  .strict();

export const AgentUpdateSchema = z
  .object({
    name: NameSchema.optional(),
    title: AgentTitleSchema.nullable().optional(),
    model: AgentModelSchema.nullable().optional(),
    providerAccountSlug: SlugSchema.nullable().optional(),
    reportsToSlug: SlugSchema.nullable().optional(),
    enabled: z.boolean().optional(),
    description: DescriptionSchema.nullable().optional(),
    capabilities: AgentCapabilitiesSchema.optional(),
    maxActiveTasks: AgentMaxActiveTasksSchema.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "nothing to update");

export const AgentSchema = z
  .object({
    slug: SlugSchema,
    name: z.string(),
    title: z.string().nullable(),
    model: z.string().nullable(),
    providerAccountSlug: z.string().nullable(),
    reportsToSlug: z.string().nullable(),
    enabled: z.boolean(),
    description: z.string().nullable(),
    capabilities: z.array(SlugSchema),
    maxActiveTasks: z.number().int(),
    activeTaskCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().nullable(),
  })
  .strict();

export const AgentListQuerySchema = ListQuerySchema;
export type Agent = z.infer<typeof AgentSchema>;
export type AgentCreate = z.infer<typeof AgentCreateSchema>;
export type AgentUpdate = z.infer<typeof AgentUpdateSchema>;
