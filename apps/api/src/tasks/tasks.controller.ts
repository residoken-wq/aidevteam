import { Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query, Req, UnprocessableEntityException } from "@nestjs/common";
import { isAllowedTransition, SlugSchema, TaskCreateSchema, TaskListQuerySchema, TaskTransitionSchema, TaskUpdateSchema, type Task } from "@aidevteam/contracts";
import type { Pool, PoolClient } from "@aidevteam/db";
import type { Request } from "express";
import { writeAudit } from "../audit";
import { getAuth, getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { verifyProjectScope } from "../rbac/project-scope";
import { DB_POOL } from "../tokens";
import { parseOr422 } from "../validation";

interface Row {
  id: string;
  number: number;
  project_slug: string;
  title: string;
  description: string | null;
  status: Task["status"];
  priority: Task["priority"];
  agent_slug: string | null;
  cancel_reason: string | null;
  epic_slug: string | null;
  sprint_number: number | null;
  created_at: Date;
  updated_at: Date;
}

interface ProjectRef {
  id: string;
  archived: boolean;
}

const SELECT = `SELECT t.id, t.number, p.slug AS project_slug, t.title, t.description, t.status, t.priority, a.slug AS agent_slug,
                       t.cancel_reason, e.slug AS epic_slug, s.number AS sprint_number, t.created_at, t.updated_at
                  FROM tasks t
                  JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
                  LEFT JOIN agents a ON a.id = t.agent_id AND a.org_id = t.org_id
                  LEFT JOIN epics e ON e.id = t.epic_id AND e.project_id = t.project_id
                  LEFT JOIN sprints s ON s.id = t.sprint_id AND s.project_id = t.project_id`;

const toDto = (r: Row): Task => ({
  number: r.number,
  projectSlug: r.project_slug,
  title: r.title,
  description: r.description,
  status: r.status,
  priority: r.priority,
  agentSlug: r.agent_slug,
  cancelReason: r.cancel_reason,
  epicSlug: r.epic_slug,
  sprintNumber: r.sprint_number,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const NUMBER_RE = /^[1-9][0-9]{0,8}$/;
const unprocessable = (path: string, message: string) => new UnprocessableEntityException({ statusCode: 422, message: "validation_failed", issues: [{ path, message }] });

/**
 * Tasks of a project in the session's org (P3-02/P3-04). Status changes only through POST …/transitions, as a
 * conditional UPDATE (WHERE status = expectedFrom) following STATE_MACHINES.md §1; the DB trigger from migration
 * 0009 refuses any other transition. Task text is untrusted data: stored and returned verbatim, never interpreted.
 */
@Controller("projects/:projectSlug/tasks")
export class TasksController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("task:read")
  @Get()
  async list(@Req() req: Request, @Param("projectSlug") projectSlug: string, @Query() query: unknown): Promise<{ items: Task[]; limit: number; offset: number }> {
    const q = parseOr422(TaskListQuerySchema, query);
    const org = getOrg(req);
    const project = await this.project(this.pool, req, projectSlug, "read");
    const r = await this.pool.query<Row>(
      `${SELECT} WHERE t.org_id = $1 AND t.project_id = $2
                   AND ($3::text IS NULL OR t.status = $3)
                   AND ($4::text IS NULL OR e.slug = $4)
                   AND ($5::int IS NULL OR s.number = $5)
                 ORDER BY t.number LIMIT $6 OFFSET $7`,
      [org.orgId, project.id, q.status ?? null, q.epic ?? null, q.sprint ?? null, q.limit, q.offset],
    );
    return { items: r.rows.map(toDto), limit: q.limit, offset: q.offset };
  }

  @RequirePermission("task:read")
  @Get(":number")
  async get(@Req() req: Request, @Param("projectSlug") projectSlug: string, @Param("number") number: string): Promise<Task> {
    const org = getOrg(req);
    const project = await this.project(this.pool, req, projectSlug, "read");
    return toDto(await this.find(this.pool, org.orgId, project.id, number));
  }

  @RequirePermission("task:write")
  @Post()
  @HttpCode(201)
  async create(@Req() req: Request, @Param("projectSlug") projectSlug: string, @Body() body: unknown): Promise<Task> {
    const input = parseOr422(TaskCreateSchema, body);
    const org = getOrg(req);
    const row = await this.tx(async (c) => {
      const project = await this.writableProject(c, req, projectSlug);
      // Serialise numbering per project; the unique (project_id, number) constraint is the backstop.
      await c.query("SELECT pg_advisory_xact_lock(hashtext('tasks:' || $1::text))", [project.id]);
      const agentId = input.agentSlug ? await this.agentId(c, org.orgId, input.agentSlug) : null;
      const epicId = input.epicSlug ? await this.epicId(c, org.orgId, project.id, input.epicSlug) : null;
      const sprintId = input.sprintNumber !== undefined ? await this.sprintId(c, org.orgId, project.id, input.sprintNumber) : null;
      const r = await c.query<{ id: string }>(
        `INSERT INTO tasks (org_id, project_id, number, title, description, priority, agent_id, epic_id, sprint_id, created_by_user_id)
         SELECT $1, $2, COALESCE(MAX(number), 0) + 1, $3, $4, $5, $6, $7, $8, $9 FROM tasks WHERE project_id = $2
         RETURNING id`,
        [org.orgId, project.id, input.title, input.description ?? null, input.priority ?? "medium", agentId, epicId, sprintId, getAuth(req).userId],
      );
      const created = await this.findById(c, org.orgId, r.rows[0]!.id);
      await this.audit(c, req, "task.created", created, {});
      return created;
    });
    return toDto(row);
  }

  @RequirePermission("task:write")
  @Patch(":number")
  async update(@Req() req: Request, @Param("projectSlug") projectSlug: string, @Param("number") number: string, @Body() body: unknown): Promise<Task> {
    const input = parseOr422(TaskUpdateSchema, body);
    const org = getOrg(req);
    const row = await this.tx(async (c) => {
      const project = await this.writableProject(c, req, projectSlug);
      const current = await this.find(c, org.orgId, project.id, number);
      if (current.status === "DONE" || current.status === "CANCELLED") throw new ConflictException({ statusCode: 409, message: "task_closed" });
      const agentId = input.agentSlug === undefined ? undefined : input.agentSlug === null ? null : await this.agentId(c, org.orgId, input.agentSlug);
      const epicId = input.epicSlug === undefined ? undefined : input.epicSlug === null ? null : await this.epicId(c, org.orgId, project.id, input.epicSlug);
      const sprintId = input.sprintNumber === undefined ? undefined : input.sprintNumber === null ? null : await this.sprintId(c, org.orgId, project.id, input.sprintNumber);
      const r = await c.query(
        `UPDATE tasks
            SET title = COALESCE($3, title),
                priority = COALESCE($4, priority),
                description = CASE WHEN $5::boolean THEN $6 ELSE description END,
                agent_id = CASE WHEN $7::boolean THEN $8::uuid ELSE agent_id END,
                epic_id = CASE WHEN $9::boolean THEN $10::uuid ELSE epic_id END,
                sprint_id = CASE WHEN $11::boolean THEN $12::uuid ELSE sprint_id END,
                updated_at = now()
          WHERE org_id = $1 AND id = $2 AND status NOT IN ('DONE', 'CANCELLED')`,
        [
          org.orgId,
          current.id,
          input.title ?? null,
          input.priority ?? null,
          input.description !== undefined,
          input.description ?? null,
          agentId !== undefined,
          agentId ?? null,
          epicId !== undefined,
          epicId ?? null,
          sprintId !== undefined,
          sprintId ?? null,
        ],
      );
      if (r.rowCount === 0) throw new ConflictException({ statusCode: 409, message: "task_closed" });
      const updated = await this.findById(c, org.orgId, current.id);
      await this.audit(c, req, "task.updated", updated, { fields: Object.keys(input).sort().join(",") });
      return updated;
    });
    return toDto(row);
  }

  @RequirePermission("task:write")
  @Post(":number/transitions")
  @HttpCode(200)
  async transition(@Req() req: Request, @Param("projectSlug") projectSlug: string, @Param("number") number: string, @Body() body: unknown): Promise<Task> {
    const input = parseOr422(TaskTransitionSchema, body);
    if (!isAllowedTransition(input.expectedFrom, input.to)) throw unprocessable("to", `transition ${input.expectedFrom} -> ${input.to} is not allowed`);
    const org = getOrg(req);
    const project = await this.writableProject(this.pool, req, projectSlug);
    const current = await this.find(this.pool, org.orgId, project.id, number);
    const r = await this.pool.query<{ id: string }>(
      `UPDATE tasks SET status = $3, cancel_reason = $4, updated_at = now()
        WHERE org_id = $1 AND id = $2 AND status = $5
       RETURNING id`,
      [org.orgId, current.id, input.to, input.to === "CANCELLED" ? input.reason! : null, input.expectedFrom],
    );
    // Another request (or a stale board) changed the status first: tell the client, never overwrite.
    if (r.rowCount === 0) throw new ConflictException({ statusCode: 409, message: "task_status_changed" });
    const row = await this.findById(this.pool, org.orgId, current.id);
    await this.audit(this.pool, req, "task.transitioned", row, {
      from: input.expectedFrom,
      to: input.to,
      ...(input.to === "DONE" ? { confirmedReviewed: "true" } : {}),
      ...(input.to === "CANCELLED" ? { fields: "reason" } : {}),
    });
    return toDto(row);
  }

  private async project(c: PoolClient | Pool, req: Request, slug: string, requiredAccess: "read" | "write" = "read"): Promise<ProjectRef> {
    if (!SlugSchema.safeParse(slug).success) throw new NotFoundException();
    const org = getOrg(req);
    const auth = getAuth(req);
    const p = await verifyProjectScope({
      pool: c,
      orgId: org.orgId,
      userId: auth.userId,
      roles: org.roles,
      requiredAccess,
      projectSlug: slug,
    });
    const r = await c.query<{ archived: boolean }>("SELECT archived_at IS NOT NULL AS archived FROM projects WHERE id = $1", [p.id]);
    return { id: p.id, archived: r.rows[0]?.archived ?? false };
  }

  private async writableProject(c: PoolClient | Pool, req: Request, slug: string): Promise<ProjectRef> {
    const p = await this.project(c, req, slug, "write");
    if (p.archived) throw new ConflictException({ statusCode: 409, message: "project_archived" });
    return p;
  }

  private async agentId(c: PoolClient, orgId: string, slug: string): Promise<string> {
    const r = await c.query<{ id: string }>("SELECT id FROM agents WHERE org_id = $1 AND slug = $2 AND archived_at IS NULL", [orgId, slug]);
    if (!r.rows[0]) throw unprocessable("agentSlug", "unknown or archived agent");
    return r.rows[0].id;
  }

  private async epicId(c: PoolClient, orgId: string, projectId: string, slug: string): Promise<string> {
    const r = await c.query<{ id: string; archived_at: Date | null }>(
      "SELECT id, archived_at FROM epics WHERE org_id = $1 AND project_id = $2 AND slug = $3",
      [orgId, projectId, slug],
    );
    if (!r.rows[0]) throw unprocessable("epicSlug", "unknown epic in this project");
    if (r.rows[0].archived_at) throw unprocessable("epicSlug", "cannot assign archived epic");
    return r.rows[0].id;
  }

  private async sprintId(c: PoolClient, orgId: string, projectId: string, number: number): Promise<string> {
    const r = await c.query<{ id: string; status: string }>(
      "SELECT id, status FROM sprints WHERE org_id = $1 AND project_id = $2 AND number = $3",
      [orgId, projectId, number],
    );
    if (!r.rows[0]) throw unprocessable("sprintNumber", "unknown sprint in this project");
    if (r.rows[0].status === "CLOSED") throw unprocessable("sprintNumber", "cannot assign closed sprint");
    return r.rows[0].id;
  }

  private async find(c: PoolClient | Pool, orgId: string, projectId: string, number: string): Promise<Row> {
    if (!NUMBER_RE.test(number)) throw new NotFoundException();
    const r = await c.query<Row>(`${SELECT} WHERE t.org_id = $1 AND t.project_id = $2 AND t.number = $3`, [orgId, projectId, Number(number)]);
    if (!r.rows[0]) throw new NotFoundException();
    return r.rows[0];
  }

  private async findById(c: PoolClient | Pool, orgId: string, id: string): Promise<Row> {
    const r = await c.query<Row>(`${SELECT} WHERE t.org_id = $1 AND t.id = $2`, [orgId, id]);
    return r.rows[0]!;
  }

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (err) {
      await c.query("ROLLBACK");
      throw err;
    } finally {
      c.release();
    }
  }

  private async audit(c: PoolClient | Pool, req: Request, action: string, row: Row, extra: Record<string, string>): Promise<void> {
    const actor = getAuth(req);
    await writeAudit(c, {
      action,
      orgId: getOrg(req).orgId,
      actorUserId: actor.userId,
      actorGithubUserId: actor.githubUserId,
      targetType: "task",
      targetId: row.id,
      metadata: { project: row.project_slug, number: String(row.number), ...extra },
    });
  }
}
