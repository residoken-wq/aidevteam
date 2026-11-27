import { z } from "zod";
import { SlugSchema } from "./common";

/**
 * P4-01/P4-03/P4-07 agent runs. Statuses and transitions mirror docs/architecture/STATE_MACHINES.md §2 (OWNER APPROVED
 * 26/11/2026, D-2026-11-26-07); run.test.ts fails if the two diverge. Migration 0010 enforces the same transitions in DB.
 */
export const RUN_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  INTERRUPTED: [],
};

export function isAllowedRunTransition(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

/** Strict output contract from mock runner. Must parse and have status: "SUCCESS" to succeed. */
export const MockOutputSchema = z
  .object({
    status: z.enum(["SUCCESS", "FAILED"]),
    summary: z.string().max(2000, "summary: at most 2000 characters"),
  })
  .strict();
export type MockOutput = z.infer<typeof MockOutputSchema>;

export const DispatchRunSchema = z
  .object({
    workerSlug: SlugSchema,
  })
  .strict();
export type DispatchRunInput = z.infer<typeof DispatchRunSchema>;

/**
 * Run DTO returned by API.
 * Never includes org_id or unredacted raw logs (CLAUDE.md §9).
 */
export const RunSchema = z
  .object({
    id: z.string().uuid(),
    projectSlug: z.string(),
    taskNumber: z.number().int().positive(),
    workerSlug: z.string(),
    status: z.enum(RUN_STATUSES),
    attempt: z.number().int().positive(),
    queuedAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    outputSummary: z.string().nullable(),
    log: z.string().nullable(),
    errorCode: z.string().nullable(),
  })
  .strict();
export type Run = z.infer<typeof RunSchema>;

export const RunListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).default(200),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    status: z.enum(RUN_STATUSES).optional(),
  })
  .strict();
export type RunListQuery = z.infer<typeof RunListQuerySchema>;
