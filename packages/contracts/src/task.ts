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

export const TaskCreateSchema = z
  .object({
    title: TitleSchema,
    description: TaskDescriptionSchema.optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    agentSlug: SlugSchema.optional(),
  })
  .strict();

/** Status is not editable here — only through the transitions endpoint. */
export const TaskUpdateSchema = z
  .object({
    title: TitleSchema.optional(),
    description: TaskDescriptionSchema.nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    agentSlug: SlugSchema.nullable().optional(),
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
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const TaskListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).default(200),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    status: z.enum(TASK_STATUSES).optional(),
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

export const TaskDependencyResultSchema = z
  .object({
    changed: z.boolean(),
  })
  .strict();
export type TaskDependencyResult = z.infer<typeof TaskDependencyResultSchema>;

export type Task = z.infer<typeof TaskSchema>;
export type TaskTransition = z.infer<typeof TaskTransitionSchema>;
