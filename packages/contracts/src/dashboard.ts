import { z } from "zod";
import { RUN_STATUSES, type RunStatus } from "./run";
import { TASK_STATUSES, type TaskStatus } from "./task";

const tasksShape = Object.fromEntries(
  TASK_STATUSES.map((s) => [s, z.number().int().nonnegative()]),
) as Record<TaskStatus, z.ZodNumber>;

const runs7dShape = Object.fromEntries(
  RUN_STATUSES.map((s) => [s, z.number().int().nonnegative()]),
) as Record<RunStatus, z.ZodNumber>;

export const RecentRunSchema = z
  .object({
    id: z.string().uuid(),
    projectSlug: z.string(),
    taskNumber: z.number().int().positive(),
    status: z.enum(RUN_STATUSES),
    finishedAt: z.string().nullable(),
  })
  .strict();

export type RecentRun = z.infer<typeof RecentRunSchema>;

export const DashboardSchema = z
  .object({
    projects: z
      .object({
        active: z.number().int().nonnegative(),
      })
      .strict(),
    agents: z
      .object({
        enabled: z.number().int().nonnegative(),
        disabled: z.number().int().nonnegative(),
      })
      .strict(),
    workers: z
      .object({
        enabled: z.number().int().nonnegative(),
        disabled: z.number().int().nonnegative(),
      })
      .strict(),
    tasks: z.object(tasksShape).strict(),
    runs7d: z.object(runs7dShape).strict(),
    recentRuns: z.array(RecentRunSchema).max(5),
  })
  .strict();

export type Dashboard = z.infer<typeof DashboardSchema>;
