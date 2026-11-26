import { z } from "zod";
import { DescriptionSchema, ListQuerySchema, NameSchema, SlugSchema } from "./common";

/**
 * Worker contracts (P2-08). Release 0.1: type "mock" only (CLAUDE.md §2 rule 8 — no real AGY).
 * workspacePath and type are immutable after creation (archive and recreate to change them).
 */
export const WORKER_TYPES = ["mock"] as const;

const SYSTEM_DIRS = ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root", "/run", "/sbin", "/sys", "/usr"];

/** Normalised absolute POSIX path: no "." / ".." / empty segments, no trailing slash, not inside system dirs. */
export const WorkspacePathSchema = z
  .string()
  .max(255, "workspacePath: at most 255 characters")
  .regex(/^(\/[A-Za-z0-9_][A-Za-z0-9._-]*)+$/, "workspacePath must be a normalised absolute path like /srv/workers/name")
  .refine((p) => p.split("/").length >= 3, "workspacePath must be at least two levels deep, e.g. /srv/workers")
  .refine((p) => !SYSTEM_DIRS.some((d) => p === d || p.startsWith(`${d}/`)), "workspacePath must not be inside a system directory");

/** True when two normalised paths are the same or one contains the other (shared worktree risk, router §6.2-4). */
export function workspacePathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export const WorkerCreateSchema = z
  .object({
    slug: SlugSchema,
    name: NameSchema,
    type: z.enum(WORKER_TYPES),
    workspacePath: WorkspacePathSchema,
    projectSlug: SlugSchema.optional(),
    description: DescriptionSchema.optional(),
  })
  .strict();

export const WorkerUpdateSchema = z
  .object({
    name: NameSchema.optional(),
    enabled: z.boolean().optional(),
    projectSlug: SlugSchema.nullable().optional(),
    description: DescriptionSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "nothing to update");

export const WorkerSchema = z
  .object({
    slug: SlugSchema,
    name: z.string(),
    type: z.enum(WORKER_TYPES),
    workspacePath: z.string(),
    projectSlug: z.string().nullable(),
    enabled: z.boolean(),
    description: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().nullable(),
  })
  .strict();

export const WorkerListQuerySchema = ListQuerySchema;
export type Worker = z.infer<typeof WorkerSchema>;
