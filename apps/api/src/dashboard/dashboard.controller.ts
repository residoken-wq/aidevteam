import { Controller, Get, Inject, Req } from "@nestjs/common";
import {
  DashboardSchema,
  RUN_STATUSES,
  TASK_STATUSES,
  type Dashboard,
  type RunStatus,
  type TaskStatus,
} from "@aidevteam/contracts";
import type { Pool } from "@aidevteam/db";
import type { Request } from "express";
import { getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { DB_POOL } from "../tokens";

@Controller("dashboard")
export class DashboardController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("dashboard:read")
  @Get()
  async get(@Req() req: Request): Promise<Dashboard> {
    const orgId = getOrg(req).orgId;

    const [projectsRes, agentsRes, workersRes, tasksRes, runs7dRes, recentRunsRes] = await Promise.all([
      this.pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM projects
          WHERE org_id = $1 AND archived_at IS NULL`,
        [orgId],
      ),
      this.pool.query<{ enabled: boolean; count: number }>(
        `SELECT enabled, count(*)::int AS count
           FROM agents
          WHERE org_id = $1 AND archived_at IS NULL
          GROUP BY enabled`,
        [orgId],
      ),
      this.pool.query<{ enabled: boolean; count: number }>(
        `SELECT enabled, count(*)::int AS count
           FROM workers
          WHERE org_id = $1 AND archived_at IS NULL
          GROUP BY enabled`,
        [orgId],
      ),
      this.pool.query<{ status: string; count: number }>(
        `SELECT status, count(*)::int AS count
           FROM tasks
          WHERE org_id = $1
          GROUP BY status`,
        [orgId],
      ),
      this.pool.query<{ status: string; count: number }>(
        `SELECT status, count(*)::int AS count
           FROM agent_runs
          WHERE org_id = $1 AND queued_at >= now() - interval '7 days'
          GROUP BY status`,
        [orgId],
      ),
      this.pool.query<{
        id: string;
        project_slug: string;
        task_number: number;
        status: string;
        finished_at: Date | string | null;
      }>(
        `SELECT r.id, p.slug AS project_slug, t.number AS task_number, r.status, r.finished_at
           FROM agent_runs r
           JOIN tasks t ON t.id = r.task_id AND t.org_id = r.org_id
           JOIN projects p ON p.id = t.project_id AND p.org_id = r.org_id
          WHERE r.org_id = $1
          ORDER BY r.queued_at DESC, r.id DESC
          LIMIT 5`,
        [orgId],
      ),
    ]);

    const activeProjects = projectsRes.rows[0]?.count ?? 0;

    const agents = { enabled: 0, disabled: 0 };
    for (const r of agentsRes.rows) {
      if (r.enabled) agents.enabled = r.count;
      else agents.disabled = r.count;
    }

    const workers = { enabled: 0, disabled: 0 };
    for (const r of workersRes.rows) {
      if (r.enabled) workers.enabled = r.count;
      else workers.disabled = r.count;
    }

    const tasks = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const r of tasksRes.rows) {
      if (r.status in tasks) {
        tasks[r.status as TaskStatus] = r.count;
      }
    }

    const runs7d = Object.fromEntries(RUN_STATUSES.map((s) => [s, 0])) as Record<RunStatus, number>;
    for (const r of runs7dRes.rows) {
      if (r.status in runs7d) {
        runs7d[r.status as RunStatus] = r.count;
      }
    }

    const recentRuns = recentRunsRes.rows.map((r) => ({
      id: r.id,
      projectSlug: r.project_slug,
      taskNumber: r.task_number,
      status: r.status,
      finishedAt: r.finished_at ? (r.finished_at instanceof Date ? r.finished_at.toISOString() : new Date(r.finished_at).toISOString()) : null,
    }));

    return DashboardSchema.parse({
      projects: { active: activeProjects },
      agents,
      workers,
      tasks,
      runs7d,
      recentRuns,
    });
  }
}
