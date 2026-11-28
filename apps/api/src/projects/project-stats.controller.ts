import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import {
  ProjectStatsQuerySchema,
  type ProjectStatsItem,
  type ProjectStatsResponse,
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
  backlog_count: number;
  todo_count: number;
  in_progress_count: number;
  in_review_count: number;
  done_count: number;
  cancelled_count: number;
  total: number;
}

@Controller("projects")
export class ProjectStatsController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("project:read")
  @Get("stats")
  async stats(@Req() req: Request, @Query() query: unknown): Promise<ProjectStatsResponse> {
    const q = parseOr422(ProjectStatsQuerySchema, query);
    const org = getOrg(req);
    const auth = getAuth(req);
    const scoped = !hasOrgWideAccess(org.roles, "read");
    const includeArchived = q.includeArchived === "true" || q.archived === "true";

    const params: unknown[] = [org.orgId, includeArchived];
    let scopedClause = "";
    if (scoped) {
      params.push(auth.userId);
      scopedClause = `AND EXISTS (
        SELECT 1 FROM project_assignments pa
         WHERE pa.org_id = p.org_id AND pa.project_id = p.id AND pa.user_id = $${params.length}
      )`;
    }

    const sql = `SELECT p.slug AS project_slug,
                        p.name AS project_name,
                        COUNT(CASE WHEN t.status = 'BACKLOG' THEN 1 END)::int AS backlog_count,
                        COUNT(CASE WHEN t.status = 'TODO' THEN 1 END)::int AS todo_count,
                        COUNT(CASE WHEN t.status = 'IN_PROGRESS' THEN 1 END)::int AS in_progress_count,
                        COUNT(CASE WHEN t.status = 'IN_REVIEW' THEN 1 END)::int AS in_review_count,
                        COUNT(CASE WHEN t.status = 'DONE' THEN 1 END)::int AS done_count,
                        COUNT(CASE WHEN t.status = 'CANCELLED' THEN 1 END)::int AS cancelled_count,
                        COUNT(t.id)::int AS total
                   FROM projects p
              LEFT JOIN tasks t ON t.project_id = p.id AND t.org_id = p.org_id
                  WHERE p.org_id = $1 AND ($2::boolean OR p.archived_at IS NULL)
                        ${scopedClause}
               GROUP BY p.id, p.slug, p.name
               ORDER BY p.name ASC, p.id`;

    const res = await this.pool.query<Row>(sql, params);

    const items: ProjectStatsItem[] = res.rows.map((r) => ({
      projectSlug: r.project_slug,
      projectName: r.project_name,
      counts: {
        BACKLOG: r.backlog_count,
        TODO: r.todo_count,
        IN_PROGRESS: r.in_progress_count,
        IN_REVIEW: r.in_review_count,
        DONE: r.done_count,
        CANCELLED: r.cancelled_count,
      },
      total: r.total,
    }));

    return { items };
  }
}
