import { z } from "zod";

/**
 * Mandatory default denylist paths (P3-06). Always merged into effectiveForbiddenPaths.
 * Any allowedPaths matching these patterns will be rejected with 422 path_forbidden.
 */
export const DEFAULT_FORBIDDEN_PATHS: readonly string[] = [
  ".env",
  ".env.*",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa*",
  ".ssh/**",
  ".git/**",
  ".github/workflows/**",
  ".agent/**",
  ".agents/**",
  "**/secrets/**",
];

export function isDenylistedPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");

  if (DEFAULT_FORBIDDEN_PATHS.includes(normalized)) return true;
  if (normalized === ".env" || normalized.startsWith(".env.")) return true;
  if (normalized.endsWith(".pem") || normalized.endsWith(".key")) return true;

  const segments = normalized.split("/");
  const basename = segments[segments.length - 1];
  if (basename && basename.startsWith("id_rsa")) return true;
  if (segments.includes("secrets")) return true;
  if (normalized.includes("secrets/")) return true;

  if (
    segments[0] === ".ssh" ||
    segments[0] === ".git" ||
    segments[0] === ".agent" ||
    segments[0] === ".agents"
  ) {
    return true;
  }

  if (normalized.startsWith(".github/workflows")) return true;

  return false;
}

export function getEffectiveForbiddenPaths(contract?: { forbiddenPaths?: string[] } | null): string[] {
  const custom = contract?.forbiddenPaths ?? [];
  const set = new Set<string>();
  const result: string[] = [];

  for (const p of custom) {
    if (!set.has(p)) {
      set.add(p);
      result.push(p);
    }
  }

  for (const p of DEFAULT_FORBIDDEN_PATHS) {
    if (!set.has(p)) {
      set.add(p);
      result.push(p);
    }
  }

  return result;
}

const PathGlobSchema = z
  .string()
  .min(1, "path is required")
  .max(500, "path: at most 500 characters")
  .superRefine((p, ctx) => {
    if (p.includes("..")) {
      ctx.addIssue({ code: "custom", message: "relative path traversal (..) is not allowed" });
    }
    if (p.startsWith("/") || p.startsWith("\\")) {
      ctx.addIssue({ code: "custom", message: "absolute path is not allowed" });
    }
    if (/^[a-zA-Z]:/.test(p)) {
      ctx.addIssue({ code: "custom", message: "drive letter path is not allowed" });
    }
  });

const FORBIDDEN_SHELL_CHARS = [";", "&&", "|", "`", "$("];

const TestCommandSchema = z
  .array(z.string().min(1, "argv element cannot be empty"))
  .min(1, "test command must have at least 1 argv element")
  .max(20, "test command can have at most 20 argv elements")
  .superRefine((argv, ctx) => {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (!arg) continue;
      for (const forbidden of FORBIDDEN_SHELL_CHARS) {
        if (arg.includes(forbidden)) {
          ctx.addIssue({
            code: "custom",
            path: [i],
            message: `shell characters (${forbidden}) are forbidden in test command argv`,
          });
        }
      }
    }
  });

const AcceptanceCriterionSchema = z
  .object({
    id: z
      .string()
      .min(1, "id is required")
      .max(50, "id: at most 50 characters")
      .regex(/^AC-[A-Za-z0-9_.-]+$/, "id must be in format AC-n (e.g. AC-1)"),
    text: z.string().min(1, "text is required").max(500, "text: at most 500 characters"),
  })
  .strict();

export const TaskContractSchema = z
  .object({
    version: z.literal(1).default(1),
    objective: z.string().min(1, "objective is required").max(2000, "objective: at most 2000 characters"),
    acceptanceCriteria: z
      .array(AcceptanceCriterionSchema)
      .min(1, "at least 1 acceptance criterion is required")
      .max(30, "at most 30 acceptance criteria are allowed"),
    allowedPaths: z.array(PathGlobSchema).max(50, "at most 50 allowed paths").default([]),
    forbiddenPaths: z.array(PathGlobSchema).max(50, "at most 50 forbidden paths").default([]),
    testCommands: z.array(TestCommandSchema).max(10, "at most 10 test commands").default([]),
    outOfScope: z
      .array(z.string().min(1, "out of scope item cannot be empty").max(300, "out of scope item: at most 300 characters"))
      .max(20, "at most 20 out of scope items")
      .default([]),
    notes: z.string().max(2000, "notes: at most 2000 characters").nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Unique AC IDs
    const ids = data.acceptanceCriteria.map((ac) => ac.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["acceptanceCriteria"],
        message: "duplicate acceptance criteria id",
      });
    }

    // Check allowedPaths against denylist
    if (data.allowedPaths) {
      for (let i = 0; i < data.allowedPaths.length; i++) {
        const p = data.allowedPaths[i];
        if (p && isDenylistedPath(p)) {
          ctx.addIssue({
            code: "custom",
            path: ["allowedPaths", i],
            message: "path_forbidden",
            params: { problem: "path_forbidden" },
          });
        }
      }
    }
  });

export type TaskContract = z.infer<typeof TaskContractSchema>;

export const TaskContractResponseSchema = z
  .object({
    contract: TaskContractSchema.nullable(),
    effectiveForbiddenPaths: z.array(z.string()),
  })
  .strict();

export type TaskContractResponse = z.infer<typeof TaskContractResponseSchema>;

export const TaskPromptResponseSchema = z
  .object({
    prompt: z.string(),
  })
  .strict();

export type TaskPromptResponse = z.infer<typeof TaskPromptResponseSchema>;
