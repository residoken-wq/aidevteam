import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import {
  ApprovalListQuerySchema,
  safeCommentUrl,
  type Approval,
} from "@aidevteam/contracts";
import type { Pool } from "@aidevteam/db";
import type { Request } from "express";
import type { AppConfig } from "../config";
import { getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { APP_CONFIG, DB_POOL } from "../tokens";
import { parseOr422 } from "../validation";

interface ApprovalRow {
  id: string;
  environment: "uat" | "production";
  decision: "approved" | "rejected";
  target_sha: string;
  release_manifest_digest: string;
  pipeline_run_id: string;
  approver_github_user_id: string | number;
  source_comment_url: string;
  decided_at: Date;
  recorded_at: Date;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toDto = (r: ApprovalRow, approvalRepo: string | null): Approval => ({
  id: r.id,
  environment: r.environment,
  decision: r.decision,
  targetSha: r.target_sha,
  releaseManifestDigest: r.release_manifest_digest,
  pipelineRunId: r.pipeline_run_id,
  approverGithubUserId: Number(r.approver_github_user_id),
  decidedAt: r.decided_at.toISOString(),
  recordedAt: r.recorded_at.toISOString(),
  sourceCommentUrl: safeCommentUrl(r.source_comment_url, approvalRepo),
});

/**
 * P6-06: Release approval records (read-only display in Release 0.1 — O-07).
 * Org is always scoped to the session (CLAUDE.md §9).
 * No mutating endpoints (POST, PUT, PATCH, DELETE).
 * No audit logged for read operations. No network or GitHub API calls.
 */
@Controller("approvals")
export class ApprovalsController {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @RequirePermission("approval:read")
  @Get()
  async list(@Req() req: Request, @Query() query: unknown): Promise<{ items: Approval[]; limit: number; offset: number }> {
    const q = parseOr422(ApprovalListQuerySchema, query);
    const org = getOrg(req);

    const conditions = ["org_id = $1"];
    const params: unknown[] = [org.orgId];

    if (q.environment) {
      params.push(q.environment);
      conditions.push(`environment = $${params.length}`);
    }

    params.push(q.limit);
    const limitIdx = params.length;
    params.push(q.offset);
    const offsetIdx = params.length;

    const sql = `SELECT id, environment, decision, target_sha, release_manifest_digest, pipeline_run_id,
                        approver_github_user_id, source_comment_url, decided_at, recorded_at
                   FROM release_approvals
                  WHERE ${conditions.join(" AND ")}
                  ORDER BY decided_at DESC, id DESC
                  LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

    const res = await this.pool.query<ApprovalRow>(sql, params);
    return {
      items: res.rows.map((r) => toDto(r, this.config.approvalRepo)),
      limit: q.limit,
      offset: q.offset,
    };
  }

  @RequirePermission("approval:read")
  @Get(":id")
  async get(@Req() req: Request, @Param("id") id: string): Promise<Approval> {
    if (!UUID_RE.test(id)) {
      throw new NotFoundException({ statusCode: 404, message: "approval_not_found" });
    }
    const org = getOrg(req);

    const res = await this.pool.query<ApprovalRow>(
      `SELECT id, environment, decision, target_sha, release_manifest_digest, pipeline_run_id,
              approver_github_user_id, source_comment_url, decided_at, recorded_at
         FROM release_approvals
        WHERE org_id = $1 AND id = $2`,
      [org.orgId, id],
    );

    if (!res.rows[0]) {
      throw new NotFoundException({ statusCode: 404, message: "approval_not_found" });
    }

    return toDto(res.rows[0], this.config.approvalRepo);
  }
}
