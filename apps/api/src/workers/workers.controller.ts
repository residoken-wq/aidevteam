import { Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query, Req, UnprocessableEntityException } from "@nestjs/common";
import {
  SlugSchema,
  WorkerCreateSchema,
  WorkerListQuerySchema,
  WorkerUpdateSchema,
  workspacePathsOverlap,
  type Worker,
} from "@aidevteam/contracts";
import type { Pool, PoolClient } from "@aidevteam/db";
import type { Request } from "express";
import { writeAudit } from "../audit";
import { getAuth, getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { DB_POOL } from "../tokens";
import { parseOr422, rethrowConflict } from "../validation";

interface Row {
  id: string;
  slug: string;
  name: string;
  type: "mock";
  workspace_path: string;
  project_slug: string | null;
  enabled: boolean;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

const SELECT = `SELECT w.id, w.slug, w.name, w.type, w.workspace_path, p.slug AS project_slug, w.enabled, w.description,
                       w.created_at, w.updated_at, w.archived_at
                  FROM workers w LEFT JOIN projects p ON p.id = w.project_id AND p.org_id = w.org_id`;

const toDto = (r: Row): Worker => ({
  slug: r.slug,
  name: r.name,
  type: r.type,
  workspacePath: r.workspace_path,
  projectSlug: r.project_slug,
  enabled: r.enabled,
  description: r.description,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  archivedAt: r.archived_at ? r.archived_at.toISOString() : null,
});

const unprocessable = (path: string, message: string) => new UnprocessableEntityException({ statusCode: 422, message: "validation_failed", issues: [{ path, message }] });

/**
 * Workers of the session's org (P2-08). Mock only in Release 0.1. Active workers may not share or nest a
 * workspace path (router v0.1 §6.2-4); creation runs under an org-level advisory lock so concurrent requests
 * cannot both pass the overlap check. Attached projects must belong to the same org (also enforced by FK).
 */
@Controller("workers")
export class WorkersController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("worker:read")
  @Get()
  async list(@Req() req: Request, @Query() query: unknown): Promise<{ items: Worker[]; limit: number; offset: number }> {
    const q = parseOr422(WorkerListQuerySchema, query);
    const r = await this.pool.query<Row>(
      `${SELECT} WHERE w.org_id = $1 AND ($2::boolean OR w.archived_at IS NULL) ORDER BY w.created_at DESC, w.id LIMIT $3 OFFSET $4`,
      [getOrg(req).orgId, q.archived === "true", q.limit, q.offset],
    );
    return { items: r.rows.map(toDto), limit: q.limit, offset: q.offset };
  }

  @RequirePermission("worker:read")
  @Get(":slug")
  async get(@Req() req: Request, @Param("slug") slug: string): Promise<Worker> {
    return toDto(await this.find(this.pool, getOrg(req).orgId, slug));
  }

  @RequirePermission("worker:write")
  @Post()
  @HttpCode(201)
  async create(@Req() req: Request, @Body() body: unknown): Promise<Worker> {
    const input = parseOr422(WorkerCreateSchema, body);
    const org = getOrg(req);
    const actor = getAuth(req);
    const row = await this.tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('workers:' || $1::text))", [org.orgId]);
      const active = await c.query<{ workspace_path: string }>("SELECT workspace_path FROM workers WHERE org_id = $1 AND archived_at IS NULL", [org.orgId]);
      if (active.rows.some((w) => workspacePathsOverlap(w.workspace_path, input.workspacePath))) {
        throw new ConflictException({ statusCode: 409, message: "workspace_path_in_use" });
      }
      const projectId = input.projectSlug ? await this.projectId(c, org.orgId, input.projectSlug) : null;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO workers (org_id, slug, name, type, workspace_path, project_id, description, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [org.orgId, input.slug, input.name, input.type, input.workspacePath, projectId, input.description ?? null, actor.userId],
        );
        return this.findById(c, org.orgId, r.rows[0]!.id);
      } catch (err) {
        rethrowConflict(err, "worker_slug_or_path_taken");
      }
    });
    await this.audit(req, "worker.created", row, { type: row.type });
    return toDto(row);
  }

  @RequirePermission("worker:write")
  @Patch(":slug")
  async update(@Req() req: Request, @Param("slug") slug: string, @Body() body: unknown): Promise<Worker> {
    const input = parseOr422(WorkerUpdateSchema, body);
    const org = getOrg(req);
    const row = await this.tx(async (c) => {
      const current = await this.find(c, org.orgId, slug);
      if (current.archived_at) throw new ConflictException({ statusCode: 409, message: "worker_archived" });
      const projectId = input.projectSlug === undefined ? undefined : input.projectSlug === null ? null : await this.projectId(c, org.orgId, input.projectSlug);
      await c.query(
        `UPDATE workers
            SET name = COALESCE($3, name),
                enabled = COALESCE($4, enabled),
                project_id = CASE WHEN $5::boolean THEN $6::uuid ELSE project_id END,
                description = CASE WHEN $7::boolean THEN $8 ELSE description END,
                updated_at = now()
          WHERE org_id = $1 AND id = $2 AND archived_at IS NULL`,
        [org.orgId, current.id, input.name ?? null, input.enabled ?? null, projectId !== undefined, projectId ?? null, input.description !== undefined, input.description ?? null],
      );
      return this.findById(c, org.orgId, current.id);
    });
    await this.audit(req, "worker.updated", row, { fields: Object.keys(input).sort().join(",") });
    return toDto(row);
  }

  @RequirePermission("worker:write")
  @Post(":slug/archive")
  @HttpCode(200)
  async archive(@Req() req: Request, @Param("slug") slug: string): Promise<Worker> {
    const org = getOrg(req);
    const current = await this.find(this.pool, org.orgId, slug);
    const r = await this.pool.query(
      "UPDATE workers SET archived_at = now(), enabled = false, updated_at = now() WHERE org_id = $1 AND id = $2 AND archived_at IS NULL",
      [org.orgId, current.id],
    );
    if (r.rowCount === 0) throw new ConflictException({ statusCode: 409, message: "worker_already_archived" });
    const row = await this.findById(this.pool, org.orgId, current.id);
    await this.audit(req, "worker.archived", row, {});
    return toDto(row);
  }

  private async projectId(c: PoolClient | Pool, orgId: string, projectSlug: string): Promise<string> {
    const r = await c.query<{ id: string }>("SELECT id FROM projects WHERE org_id = $1 AND slug = $2 AND archived_at IS NULL", [orgId, projectSlug]);
    // Another org's project and a missing/archived one look the same.
    if (!r.rows[0]) throw unprocessable("projectSlug", "unknown or archived project");
    return r.rows[0].id;
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

  private async audit(req: Request, action: string, row: Row, extra: Record<string, string>): Promise<void> {
    const actor = getAuth(req);
    await writeAudit(this.pool, {
      action,
      orgId: getOrg(req).orgId,
      actorUserId: actor.userId,
      actorGithubUserId: actor.githubUserId,
      targetType: "worker",
      targetId: row.id,
      metadata: { slug: row.slug, ...extra },
    });
  }

  private async find(c: PoolClient | Pool, orgId: string, slug: string): Promise<Row> {
    if (!SlugSchema.safeParse(slug).success) throw new NotFoundException();
    const r = await c.query<Row>(`${SELECT} WHERE w.org_id = $1 AND w.slug = $2`, [orgId, slug]);
    if (!r.rows[0]) throw new NotFoundException();
    return r.rows[0];
  }

  private async findById(c: PoolClient | Pool, orgId: string, id: string): Promise<Row> {
    const r = await c.query<Row>(`${SELECT} WHERE w.org_id = $1 AND w.id = $2`, [orgId, id]);
    return r.rows[0]!;
  }
}
