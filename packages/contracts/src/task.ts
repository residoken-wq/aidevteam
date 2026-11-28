import { z } from "zod";
import { SlugSchema } from "./common";

/**
 * P3-02/P3-04 tasks. Statuses and transitions mirror docs/architecture/STATE_MACHINES.md §1 (OWNER APPROVED
 * 26/11/2026, D-2026-11-26-07); task.test.ts fails if the two diverge. Migration 0009 enforces the same pairs.
 */
export const TASK_STATUSES = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  BACKLOG: ["TODO", "CANCELLED"],
  TODO: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["IN_REVIEW", "CANCELLED"],
  IN_REVIEW: ["IN_PROGRESS", "DONE"],
  DONE: [],
  CANCELLED: [],
};

export function isAllowedTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

const TitleSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().min(1, "title is required").max(200, "title: at most 200 characters"));

/** Untrusted plain text. Never rendered as HTML and never interpreted as instructions (CLAUDE.md §2 rule 9). */
export const TaskDescriptionSchema = z.string().max(10_000, "description: at most 10000 characters");

export const TaskRequiredCapabilitiesSchema = z
  .array(SlugSchema)
  .max(10, "requiredCapabilities: at most 10 tags")
  .refine((items) => new Set(items).size === items.length, {
    message: "requiredCapabilities: duplicate tags are not allowed",
  });

export const TaskCreateSchema = z
  .object({
    title: TitleSchema,
    description: TaskDescriptionSchema.optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    agentSlug: SlugSchema.optional(),
    epicSlug: SlugSchema.optional(),
    sprintNumber: z.number().int().positive().optional(),
    requiredCapabilities: TaskRequiredCapabilitiesSchema.optional(),
  })
  .strict();

/** Status is not editable here — only through the transitions endpoint. */
export const TaskUpdateSchema = z
  .object({
    title: TitleSchema.optional(),
    description: TaskDescriptionSchema.nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    agentSlug: SlugSchema.nullable().optional(),
    epicSlug: SlugSchema.nullable().optional(),
    sprintNumber: z.number().int().positive().nullable().optional(),
    requiredCapabilities: TaskRequiredCapabilitiesSchema.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "nothing to update");

const ReasonSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().min(1, "reason is required").max(500, "reason: at most 500 characters"));

/**
 * `expectedFrom` makes the update conditional (WHERE status = expectedFrom): a stale board gets 409, not a silent
 * overwrite. DONE needs an explicit human confirmation (§2 rule 11); CANCELLED needs a reason (§1 table).
 */
export const TaskTransitionSchema = z
  .object({
    expectedFrom: z.enum(TASK_STATUSES),
    to: z.enum(TASK_STATUSES),
    reason: ReasonSchema.optional(),
    confirmReviewed: z.literal(true).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.to === "CANCELLED" && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "a reason is required to cancel" });
    if (v.to !== "CANCELLED" && v.reason !== undefined) ctx.addIssue({ code: "custom", path: ["reason"], message: "reason is only for cancelling" });
    if (v.to === "DONE" && v.confirmReviewed !== true)
      ctx.addIssue({ code: "custom", path: ["confirmReviewed"], message: "confirm that acceptance criteria, tests and review are done" });
    if (v.to !== "DONE" && v.confirmReviewed !== undefined) ctx.addIssue({ code: "custom", path: ["confirmReviewed"], message: "only for DONE" });
  });

export const TaskSchema = z
  .object({
    number: z.number().int().positive(),
    projectSlug: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(TASK_PRIORITIES),
    agentSlug: z.string().nullable(),
    cancelReason: z.string().nullable(),
    epicSlug: z.string().nullable(),
    sprintNumber: z.number().int().positive().nullable(),
    requiredCapabilities: z.array(SlugSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const TaskListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).default(200),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    status: z.enum(TASK_STATUSES).optional(),
    epic: SlugSchema.optional(),
    sprint: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const TaskDependencyChangeSchema = z
  .object({
    dependsOn: z.number().int().positive(),
  })
  .strict();
export type TaskDependencyChange = z.infer<typeof TaskDependencyChangeSchema>;

export const TaskDependencyItemSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    status: z.enum(TASK_STATUSES),
  })
  .strict();
export type TaskDependencyItem = z.infer<typeof TaskDependencyItemSchema>;

export const TaskDependenciesSchema = z
  .object({
    dependsOn: z.array(TaskDependencyItemSchema),
    blockedBy: z.array(TaskDependencyItemSchema),
    dependents: z.array(TaskDependencyItemSchema),
  })
  .strict();
export type TaskDependencies = z.infer<typeof TaskDependenciesSchema>;

/** All dependency edges of one project in a single response (Kanban: avoids one request per task). */
export const ProjectTaskDependencyEdgeSchema = z
  .object({
    task: TaskDependencyItemSchema,
    dependsOn: TaskDependencyItemSchema,
  })
  .strict();
export type ProjectTaskDependencyEdge = z.infer<typeof ProjectTaskDependencyEdgeSchema>;

export const ProjectTaskDependenciesSchema = z
  .object({
    items: z.array(ProjectTaskDependencyEdgeSchema),
  })
  .strict();
export type ProjectTaskDependencies = z.infer<typeof ProjectTaskDependenciesSchema>;

export const TaskDependencyResultSchema = z
  .object({
    changed: z.boolean(),
  })
  .strict();
export type TaskDependencyResult = z.infer<typeof TaskDependencyResultSchema>;

export const TaskCommentCreateSchema = z
  .object({
    body: z
      .string()
      .min(1, "body is required")
      .max(5000, "body: at most 5000 characters")
      .refine((s) => s.trim().length > 0, "body cannot be empty"),
  })
  .strict();
export type TaskCommentCreate = z.infer<typeof TaskCommentCreateSchema>;

export const TaskCommentSchema = z
  .object({
    id: z.string().uuid(),
    body: z.string(),
    createdAt: z.string(),
    authorGithubUserId: z.number().int().positive().nullable(),
    authorLogin: z.string().nullable(),
  })
  .strict();
export type TaskComment = z.infer<typeof TaskCommentSchema>;

export const TaskActivityItemSchema = z
  .object({
    id: z.string().optional(),
    kind: z.enum(["event", "comment"]),
    at: z.string(),
    actorGithubUserId: z.number().int().positive().nullable(),
    actorLogin: z.string().nullable(),
    action: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
    body: z.string().optional(),
  })
  .strict();
export type TaskActivityItem = z.infer<typeof TaskActivityItemSchema>;

export const TaskActivityQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();
export type TaskActivityQuery = z.infer<typeof TaskActivityQuerySchema>;

export const TaskActivityResponseSchema = z
  .object({
    items: z.array(TaskActivityItemSchema),
    limit: z.number().int().positive(),
    offset: z.number().int().min(0),
  })
  .strict();
export type TaskActivityResponse = z.infer<typeof TaskActivityResponseSchema>;

export type Task = z.infer<typeof TaskSchema>;
export type TaskTransition = z.infer<typeof TaskTransitionSchema>;
