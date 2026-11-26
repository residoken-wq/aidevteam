import { Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import {
  ProjectCreateSchema,
  ProjectListQuerySchema,
  ProjectSlugSchema,
  ProjectUpdateSchema,
  type Project,
} from "@aidevteam/contracts";
import type { Pool } from "@aidevteam/db";
import type { Request } from "express";
import { writeAudit } from "../audit";
import { getAuth, getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { DB_POOL } from "../tokens";
import { parseOr422, rethrowConflict } from "../validation";

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

const COLUMNS = "id, slug, name, description, created_at, updated_at, archived_at";

const toDto = (r: ProjectRow): Project => ({
  slug: r.slug,
  name: r.name,
  description: r.description,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  archivedAt: r.archived_at ? r.archived_at.toISOString() : null,
});

/**
 * Projects of the session's org (P2-10). Every statement filters on the org from the session; another org's
 * project and a missing one both return 404. No hard delete — archive is the only removal (soft delete).
 */
@Controller("projects")
export class ProjectsController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("project:read")
  @Get()
  async list(@Req() req: Request, @Query() query: unknown): Promise<{ items: Project[]; limit: number; offset: number }> {
    const q = parseOr422(ProjectListQuerySchema, query);
    const r = await this.pool.query<ProjectRow>(
      `SELECT ${COLUMNS} FROM projects
        WHERE org_id = $1 AND ($2::boolean OR archived_at IS NULL)
        ORDER BY created_at DESC, id
        LIMIT $3 OFFSET $4`,
      [getOrg(req).orgId, q.archived === "true", q.limit, q.offset],
    );
    return { items: r.rows.map(toDto), limit: q.limit, offset: q.offset };
  }

  @RequirePermission("project:read")
  @Get(":slug")
  async get(@Req() req: Request, @Param("slug") slugRaw: string): Promise<Project> {
    return toDto(await this.find(getOrg(req).orgId, slugRaw));
  }

  @RequirePermission("project:write")
  @Post()
  @HttpCode(201)
  async create(@Req() req: Request, @Body() body: unknown): Promise<Project> {
    const input = parseOr422(ProjectCreateSchema, body);
    const org = getOrg(req);
    const actor = getAuth(req);
    let row: ProjectRow;
    try {
      const r = await this.pool.query<ProjectRow>(
        `INSERT INTO projects (org_id, slug, name, description, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
        [org.orgId, input.slug, input.name, input.description ?? null, actor.userId],
      );
      row = r.rows[0]!;
    } catch (err) {
      rethrowConflict(err, "project_slug_or_name_taken");
    }
    await writeAudit(this.pool, {
      action: "project.created",
      orgId: org.orgId,
      actorUserId: actor.userId,
      actorGithubUserId: actor.githubUserId,
      targetType: "project",
      targetId: row.id,
      metadata: { slug: row.slug },
    });
    return toDto(row);
  }

  @RequirePermission("project:write")
  @Patch(":slug")
  async update(@Req() req: Request, @Param("slug") slugRaw: string, @Body() body: unknown): Promise<Project> {
    const input = parseOr422(ProjectUpdateSchema, body);
    const org = getOrg(req);
    const actor = getAuth(req);
    const current = await this.find(org.orgId, slugRaw);
    if (current.archived_at) throw new ConflictException({ statusCode: 409, message: "project_archived" });
    let row: ProjectRow | undefined;
    try {
      const r = await this.pool.query<ProjectRow>(
        `UPDATE projects
            SET name = COALESCE($3, name),
                description = CASE WHEN $4::boolean THEN $5 ELSE description END,
                updated_at = now()
          WHERE org_id = $1 AND id = $2 AND archived_at IS NULL
          RETURNING ${COLUMNS}`,
        [org.orgId, current.id, input.name ?? null, input.description !== undefined, input.description ?? null],
      );
      row = r.rows[0];
    } catch (err) {
      rethrowConflict(err, "project_slug_or_name_taken");
    }
    if (!row) throw new ConflictException({ statusCode: 409, message: "project_archived" });
    await writeAudit(this.pool, {
      action: "project.updated",
      orgId: org.orgId,
      actorUserId: actor.userId,
      actorGithubUserId: actor.githubUserId,
      targetType: "project",
      targetId: row.id,
      // Field names only; values (e.g. description text) are not copied into the audit log.
      metadata: { slug: row.slug, fields: Object.keys(input).sort().join(",") },
    });
    return toDto(row);
  }

  @RequirePermission("project:write")
  @Post(":slug/archive")
  @HttpCode(200)
  async archive(@Req() req: Request, @Param("slug") slugRaw: string): Promise<Project> {
    const org = getOrg(req);
    const actor = getAuth(req);
    const current = await this.find(org.orgId, slugRaw);
    const r = await this.pool.query<ProjectRow>(
      `UPDATE projects SET archived_at = now(), updated_at = now()
        WHERE org_id = $1 AND id = $2 AND archived_at IS NULL
        RETURNING ${COLUMNS}`,
      [org.orgId, current.id],
    );
    const row = r.rows[0];
    if (!row) throw new ConflictException({ statusCode: 409, message: "project_already_archived" });
    await writeAudit(this.pool, {
      action: "project.archived",
      orgId: org.orgId,
      actorUserId: actor.userId,
      actorGithubUserId: actor.githubUserId,
      targetType: "project",
      targetId: row.id,
      metadata: { slug: row.slug },
    });
    return toDto(row);
  }

  private async find(orgId: string, slugRaw: string): Promise<ProjectRow> {
    if (!ProjectSlugSchema.safeParse(slugRaw).success) throw new NotFoundException();
    const r = await this.pool.query<ProjectRow>(`SELECT ${COLUMNS} FROM projects WHERE org_id = $1 AND slug = $2`, [orgId, slugRaw]);
    if (!r.rows[0]) throw new NotFoundException();
    return r.rows[0];
  }
}
