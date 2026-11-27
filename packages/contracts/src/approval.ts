import { z } from "zod";

export const APPROVAL_ENVIRONMENTS = ["uat", "production"] as const;
export type ApprovalEnvironment = (typeof APPROVAL_ENVIRONMENTS)[number];

export const APPROVAL_DECISIONS = ["approved", "rejected"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/**
 * P6-06 — Release approval contract (read-only in Release 0.1, CLAUDE.md O-07).
 */
export const ApprovalSchema = z
  .object({
    id: z.string().uuid(),
    environment: z.enum(APPROVAL_ENVIRONMENTS),
    decision: z.enum(APPROVAL_DECISIONS),
    targetSha: z.string(),
    releaseManifestDigest: z.string(),
    pipelineRunId: z.string(),
    approverGithubUserId: z.number().int().positive(),
    decidedAt: z.string(),
    recordedAt: z.string(),
    sourceCommentUrl: z.string().nullable(),
  })
  .strict();

export type Approval = z.infer<typeof ApprovalSchema>;

export const ApprovalListQuerySchema = z
  .object({
    environment: z.enum(APPROVAL_ENVIRONMENTS).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type ApprovalListQuery = z.infer<typeof ApprovalListQuerySchema>;

export const ApprovalListResponseSchema = z
  .object({
    items: z.array(ApprovalSchema),
    limit: z.number().int(),
    offset: z.number().int(),
  })
  .strict();

export type ApprovalListResponse = z.infer<typeof ApprovalListResponseSchema>;

interface UrlComponents {
  protocol: string;
  hostname: string;
  username: string;
  password: string;
  port: string;
  search: string;
}

const UrlParser = (globalThis as unknown as { URL: new (url: string) => UrlComponents }).URL;

/**
 * Pure function: only returns url when repo is non-null, url is valid https://github.com,
 * has no userinfo/port/query, and matches ^https://github\.com/<repo>/pull/[0-9]+#issuecomment-[0-9]+$.
 * Repo matching is strictly case-sensitive with regex chars escaped. Everything else -> null.
 */
export function safeCommentUrl(url: string, repo: string | null): string | null {
  if (!repo) return null;
  let parsed: UrlComponents;
  try {
    parsed = new UrlParser(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.hostname !== "github.com") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.port !== "") return null;
  if (parsed.search !== "") return null;

  const escapedRepo = repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^https://github\\.com/${escapedRepo}/pull/[0-9]+#issuecomment-[0-9]+$`);
  if (!pattern.test(url)) return null;

  return url;
}
