import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  TaskActivityQuerySchema,
  type TaskActivityResponse,
  TaskCommentCreateSchema,
  type TaskComment,
  type TaskActivityItem,
  redact,
} from "@aidevteam/contracts";
import type { Pool } from "@aidevteam/db";
import type { Request } from "express";
import { writeAudit } from "../audit";
import { RateLimitService, type RateLimitRule } from "../rate-limit";
import { getAuth, getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { verifyProjectScope } from "../rbac/project-scope";
import { DB_POOL } from "../tokens";
import { parseOr422 } from "../validation";

const NUMBER_RE = /^[1-9][0-9]{0,8}$/;

export const COMMENT_RATE_LIMIT: RateLimitRule = {
  scope: "tasks.comment",
  limit: 30,
  windowSeconds: 60,
};

export const ALLOWED_ACTIVITY_DETAIL_KEYS = new Set([
  "from",
  "to",
  "fields",
  "reason",
  "number",
  "dependsOn",
  "count",
  "length",
  "confirmedReviewed",
]);

export function filterActivityDetails(metadata: unknown): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  if (typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)) {
    for (const [key, value] of Object.entries(metadata)) {
      if (ALLOWED_ACTIVITY_DETAIL_KEYS.has(key)) {
        details[key] = typeof value === "string" ? redact(value) : value;
      }
    }
  }
  return details;
}

interface TaskRow {
  id: string;
  number: number;
  status: string;
}

interface ActivityRow {
  kind: "event" | "comment";
  id: string;
  at: Date;
  actor_github_user_id: string | null;
  actor_login: string | null;
  action: string | null;
  metadata: unknown;
  body: string | null;
}

@Controller("projects/:projectSlug/tasks/:number")
export class TaskActivityController {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly rateLimit: RateLimitService,
  ) {}

  @RequirePermission("task:read")
  @Get("activity")
  async getActivity(
    @Req() req: Request,
    @Param("projectSlug") projectSlug: string,
    @Param("number") numberStr: string,
    @Query() queryRaw: unknown,
  ): Promise<TaskActivityResponse> {
    if (!NUMBER_RE.test(numberStr)) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
    const number = Number(numberStr);
    const query = parseOr422(TaskActivityQuerySchema, queryRaw);
    const org = getOrg(req);
    const auth = getAuth(req);

    const project = await verifyProjectScope({
      pool: this.pool,
      orgId: org.orgId,
      userId: auth.userId,
      roles: org.roles,
      requiredAccess: "read",
      projectSlug,
    });

    const taskRes = await this.pool.query<TaskRow>(
      "SELECT id, number, status FROM tasks WHERE org_id = $1 AND project_id = $2 AND number = $3",
      [org.orgId, project.id, number],
    );
    if (!taskRes.rows[0]) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
    const task = taskRes.rows[0];

    const result = await this.pool.query<ActivityRow>(
      `SELECT kind, id, at, actor_github_user_id, actor_login, action, metadata, body
         FROM (
           SELECT
             'event' AS kind,
             ae.id::text AS id,
             ae.occurred_at AS at,
             COALESCE(ae.actor_github_user_id, u.github_user_id)::text AS actor_github_user_id,
             u.github_login AS actor_login,
             ae.action AS action,
             ae.metadata AS metadata,
             NULL::text AS body
            FROM audit_events ae
            LEFT JOIN users u ON u.id = ae.actor_user_id
           WHERE ae.org_id = $1 AND ae.target_type = 'task' AND ae.target_id = $2 AND ae.action LIKE 'task.%'

           UNION ALL

           SELECT
             'comment' AS kind,
             tc.id::text AS id,
             tc.created_at AS at,
             u.github_user_id::text AS actor_github_user_id,
             u.github_login AS actor_login,
             NULL::text AS action,
             '{}'::jsonb AS metadata,
             tc.body AS body
            FROM task_comments tc
            LEFT JOIN users u ON u.id = tc.author_user_id
           WHERE tc.org_id = $1 AND tc.project_id = $3 AND tc.task_id = $2
         ) combined
        ORDER BY at ASC, id ASC
        LIMIT $4 OFFSET $5`,
      [org.orgId, task.id, project.id, query.limit, query.offset],
    );

    const items: TaskActivityItem[] = result.rows.map((row) => {
      const actorGithubUserId = row.actor_github_user_id ? Number(row.actor_github_user_id) : null;
      if (row.kind === "event") {
        return {
          kind: "event",
          at: row.at.toISOString(),
          actorGithubUserId,
          actorLogin: row.actor_login,
          action: row.action!,
          details: filterActivityDetails(row.metadata),
        };
      }
      return {
        kind: "comment",
        at: row.at.toISOString(),
        actorGithubUserId,
        actorLogin: row.actor_login,
        body: row.body!,
      };
    });

    return {
      items,
      limit: query.limit,
      offset: query.offset,
    };
  }

  @RequirePermission("task:write")
  @Post("comments")
  @HttpCode(201)
  async addComment(
    @Req() req: Request,
    @Param("projectSlug") projectSlug: string,
    @Param("number") numberStr: string,
    @Body() body: unknown,
  ): Promise<TaskComment> {
    if (!NUMBER_RE.test(numberStr)) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
    const number = Number(numberStr);
    const input = parseOr422(TaskCommentCreateSchema, body);
    const org = getOrg(req);
    const auth = getAuth(req);

    const limit = await this.rateLimit.hit(COMMENT_RATE_LIMIT, auth.userId);
    if (!limit.allowed) {
      throw new HttpException(
        { statusCode: 429, message: "rate_limit_exceeded" },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const project = await verifyProjectScope({
        pool: client,
        orgId: org.orgId,
        userId: auth.userId,
        roles: org.roles,
        requiredAccess: "write",
        projectSlug,
      });

      const pArchived = await client.query<{ archived: boolean }>(
        "SELECT archived_at IS NOT NULL AS archived FROM projects WHERE org_id = $1 AND id = $2",
        [org.orgId, project.id],
      );
      if (pArchived.rows[0]?.archived) {
        throw new ConflictException({ statusCode: 409, message: "project_archived" });
      }

      const taskRes = await client.query<TaskRow>(
        "SELECT id, number, status FROM tasks WHERE org_id = $1 AND project_id = $2 AND number = $3",
        [org.orgId, project.id, number],
      );
      if (!taskRes.rows[0]) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
      const task = taskRes.rows[0];

      const insertRes = await client.query<{ id: string; body: string; created_at: Date }>(
        `INSERT INTO task_comments (org_id, project_id, task_id, author_user_id, body)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, body, created_at`,
        [org.orgId, project.id, task.id, auth.userId, input.body],
      );
      const inserted = insertRes.rows[0]!;

      await writeAudit(client as unknown as Pool, {
        action: "task.commented",
        orgId: org.orgId,
        actorUserId: auth.userId,
        actorGithubUserId: auth.githubUserId,
        targetType: "task",
        targetId: task.id,
        metadata: {
          number: task.number,
          length: input.body.length,
        },
      });

      await client.query("COMMIT");

      return {
        id: inserted.id,
        body: inserted.body,
        createdAt: inserted.created_at.toISOString(),
        authorGithubUserId: auth.githubUserId > 0 ? auth.githubUserId : null,
        authorLogin: auth.githubLogin,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
