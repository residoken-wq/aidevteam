import { z } from "zod";
import { SlugSchema } from "./common";

export const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

export const EpicTitleSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().min(1, "title is required").max(200, "title: at most 200 characters"));

export const MilestoneTitleSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().min(1, "title is required").max(200, "title: at most 200 characters"));

export const SprintNameSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().min(1, "name is required").max(120, "name: at most 120 characters"));

// --- Epics ---

export const EpicCreateSchema = z
  .object({
    slug: SlugSchema,
    title: EpicTitleSchema,
    description: z.string().max(10_000, "description: at most 10000 characters").optional(),
    milestoneSlug: SlugSchema.nullable().optional(),
  })
  .strict();

export const EpicUpdateSchema = z
  .object({
    title: EpicTitleSchema.optional(),
    description: z.string().max(10_000, "description: at most 10000 characters").nullable().optional(),
    milestoneSlug: SlugSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "nothing to update");

export const EpicSchema = z
  .object({
    slug: SlugSchema,
    projectSlug: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    milestoneSlug: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().nullable(),
  })
  .strict();

export const EpicListResponseSchema = z
  .object({
    items: z.array(EpicSchema),
    limit: z.number().int(),
    offset: z.number().int(),
  })
  .strict();

export type Epic = z.infer<typeof EpicSchema>;
export type EpicCreate = z.infer<typeof EpicCreateSchema>;
export type EpicUpdate = z.infer<typeof EpicUpdateSchema>;

// --- Milestones ---

export const MilestoneCreateSchema = z
  .object({
    slug: SlugSchema,
    title: MilestoneTitleSchema,
    dueDate: DateStringSchema.nullable().optional(),
  })
  .strict();

export const MilestoneUpdateSchema = z
  .object({
    title: MilestoneTitleSchema.optional(),
    dueDate: DateStringSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "nothing to update");

export const MilestoneSchema = z
  .object({
    slug: SlugSchema,
    projectSlug: z.string(),
    title: z.string(),
    dueDate: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().nullable(),
  })
  .strict();

export const MilestoneListResponseSchema = z
  .object({
    items: z.array(MilestoneSchema),
    limit: z.number().int(),
    offset: z.number().int(),
  })
  .strict();

export type Milestone = z.infer<typeof MilestoneSchema>;
export type MilestoneCreate = z.infer<typeof MilestoneCreateSchema>;
export type MilestoneUpdate = z.infer<typeof MilestoneUpdateSchema>;

// --- Sprints ---

export const SPRINT_STATUSES = ["PLANNED", "ACTIVE", "CLOSED"] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];

export const SprintCreateSchema = z
  .object({
    name: SprintNameSchema,
    startDate: DateStringSchema,
    endDate: DateStringSchema,
  })
  .strict()
  .refine((v) => v.endDate >= v.startDate, {
    message: "end_date must be greater than or equal to start_date",
    path: ["endDate"],
  });

export const SprintUpdateSchema = z
  .object({
    name: SprintNameSchema.optional(),
    startDate: DateStringSchema.optional(),
    endDate: DateStringSchema.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "nothing to update")
  .refine((v) => {
    if (v.startDate && v.endDate) {
      return v.endDate >= v.startDate;
    }
    return true;
  }, {
    message: "end_date must be greater than or equal to start_date",
    path: ["endDate"],
  });

export const SprintTransitionSchema = z
  .object({
    to: z.enum(["ACTIVE", "CLOSED"]),
  })
  .strict();

export const SprintSchema = z
  .object({
    number: z.number().int().positive(),
    projectSlug: z.string(),
    name: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    status: z.enum(SPRINT_STATUSES),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const SprintListResponseSchema = z
  .object({
    items: z.array(SprintSchema),
    limit: z.number().int(),
    offset: z.number().int(),
  })
  .strict();

export type Sprint = z.infer<typeof SprintSchema>;
export type SprintCreate = z.infer<typeof SprintCreateSchema>;
export type SprintUpdate = z.infer<typeof SprintUpdateSchema>;
export type SprintTransition = z.infer<typeof SprintTransitionSchema>;
