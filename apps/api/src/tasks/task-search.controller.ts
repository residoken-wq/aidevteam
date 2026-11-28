import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import {
  parseTaskSearchStatuses,
  TaskSearchQuerySchema,
  type TaskPriority,
  type TaskSearchItem,
  type TaskSearchResponse,
  type TaskStatus,
} from "@aidevteam/contracts";
import type { Pool } from "@aidevteam/db";
import type { Request } from "express";
import { getAuth, getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { hasOrgWideAccess } from "../rbac/project-scope";
import { DB_POOL } from "../tokens";
import { parseOr422 } from "../validation";

interface Row {
  project_slug: string;
  project_name: string;
  number: number;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  agent_slug: string | null;
  updated_at: Date;
}

function escapeLike(str: string): string {
  return str.replace(/[\\%_]/g, "\\$&");
}

@Controller("tasks")
export class TaskSearchController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("task:read")
  @Get("search")
  async search(@Req() req: Request, @Query() query: unknown): Promise<TaskSearchResponse> {
    const q = parseOr422(TaskSearchQuerySchema, query);
    const org = getOrg(req);
    const auth = getAuth(req);
    const scoped = !hasOrgWideAccess(org.roles, "read");
    const statuses = parseTaskSearchStatuses(q.status);
    const includeArchived = q.includeArchived === "true" || q.archived === "true";

    const params: unknown[] = [org.orgId, includeArchived];
    const where: string[] = [
      "t.org_id = $1",
      "p.org_id = $1",
      "($2::boolean OR p.archived_at IS NULL)",
    ];

    if (scoped) {
      params.push(auth.userId);
      where.push(
        `EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.org_id = t.org_id AND pa.project_id = t.project_id AND pa.user_id = $${params.length})`,
      );
    }

    if (q.q) {
      params.push(`%${escapeLike(q.q)}%`);
      where.push(`t.title ILIKE $${params.length} ESCAPE '\\'`);
    }

    if (q.project) {
      params.push(q.project);
      where.push(`p.slug = $${params.length}`);
    }

    if (q.agent === "none") {
      where.push("t.agent_id IS NULL");
    } else if (q.agent) {
      params.push(q.agent);
      where.push(`a.slug = $${params.length}`);
    }

    if (statuses && statuses.length > 0) {
      params.push(statuses);
      where.push(`t.status = ANY($${params.length}::text[])`);
    }

    if (q.priority) {
      params.push(q.priority);
      where.push(`t.priority = $${params.length}`);
    }

    const whereClause = where.join(" AND ");

    const countSql = `SELECT count(*)::int AS total
                        FROM tasks t
                        JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
                        LEFT JOIN agents a ON a.id = t.agent_id AND a.org_id = t.org_id
                       WHERE ${whereClause}`;

    const countParams = [...params];

    params.push(q.limit, q.offset);
    const dataSql = `SELECT p.slug AS project_slug,
                            p.name AS project_name,
                            t.number,
                            t.title,
                            t.status,
                            t.priority,
                            a.slug AS agent_slug,
                            t.updated_at
                       FROM tasks t
                       JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
                       LEFT JOIN agents a ON a.id = t.agent_id AND a.org_id = t.org_id
                      WHERE ${whereClause}
                      ORDER BY t.updated_at DESC, t.id
                      LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const [countRes, dataRes] = await Promise.all([
      this.pool.query<{ total: number }>(countSql, countParams),
      this.pool.query<Row>(dataSql, params),
    ]);

    const items: TaskSearchItem[] = dataRes.rows.map((r) => ({
      projectSlug: r.project_slug,
      projectName: r.project_name,
      number: r.number,
      title: r.title,
      status: r.status,
      priority: r.priority,
      agentSlug: r.agent_slug,
      updatedAt: r.updated_at.toISOString(),
    }));

    return {
      items,
      limit: q.limit,
      offset: q.offset,
      total: countRes.rows[0]?.total ?? 0,
    };
  }
}
