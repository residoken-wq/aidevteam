import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  ProjectCreateSchema,
  ProjectListQuerySchema,
  ProjectMemberAssignSchema,
  ProjectMemberUnassignSchema,
  ProjectSlugSchema,
  ProjectUpdateSchema,
  type Project,
  type ProjectMember,
  type ProjectMemberResult,
} from "@aidevteam/contracts";
import type { Pool } from "@aidevteam/db";
import type { Request } from "express";
import { writeAudit } from "../audit";
import { getAuth, getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { isProjectScoped, verifyProjectScope } from "../rbac/project-scope";
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
    const org = getOrg(req);
    const auth = getAuth(req);
    const scoped = isProjectScoped(org.roles);

    const r = scoped
      ? await this.pool.query<ProjectRow>(
          `SELECT ${COLUMNS} FROM projects p
            WHERE p.org_id = $1 AND ($2::boolean OR p.archived_at IS NULL)
              AND EXISTS (
                SELECT 1 FROM project_assignments pa
                 WHERE pa.org_id = p.org_id AND pa.project_id = p.id AND pa.user_id = $5
              )
            ORDER BY p.created_at DESC, p.id
            LIMIT $3 OFFSET $4`,
          [org.orgId, q.archived === "true", q.limit, q.offset, auth.userId],
        )
      : await this.pool.query<ProjectRow>(
          `SELECT ${COLUMNS} FROM projects
            WHERE org_id = $1 AND ($2::boolean OR archived_at IS NULL)
            ORDER BY created_at DESC, id
            LIMIT $3 OFFSET $4`,
          [org.orgId, q.archived === "true", q.limit, q.offset],
        );
    return { items: r.rows.map(toDto), limit: q.limit, offset: q.offset };
  }

  @RequirePermission("project:read")
  @Get(":slug")
  async get(@Req() req: Request, @Param("slug") slugRaw: string): Promise<Project> {
    const org = getOrg(req);
    const auth = getAuth(req);
    await verifyProjectScope({
      pool: this.pool,
      orgId: org.orgId,
      userId: auth.userId,
      roles: org.roles,
      requiredAccess: "read",
      projectSlug: slugRaw,
    });
    return toDto(await this.find(org.orgId, slugRaw));
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

  @RequirePermission("project:read")
  @Get(":slug/members")
  async listMembers(@Req() req: Request, @Param("slug") slugRaw: string): Promise<ProjectMember[]> {
    const org = getOrg(req);
    const auth = getAuth(req);
    const project = await verifyProjectScope({
      pool: this.pool,
      orgId: org.orgId,
      userId: auth.userId,
      roles: org.roles,
      requiredAccess: "read",
      projectSlug: slugRaw,
    });
    const r = await this.pool.query<{
      github_user_id: string | number;
      github_login: string | null;
      access: "read" | "write";
      created_at: Date;
    }>(
      `SELECT u.github_user_id, u.github_login, pa.access, pa.created_at
         FROM project_assignments pa
         JOIN users u ON u.id = pa.user_id
        WHERE pa.org_id = $1 AND pa.project_id = $2
        ORDER BY u.github_user_id ASC`,
      [org.orgId, project.id],
    );
    return r.rows.map((row) => ({
      githubUserId: Number(row.github_user_id),
      githubLogin: row.github_login,
      access: row.access,
      createdAt: row.created_at.toISOString(),
    }));
  }

  @RequirePermission("project:assign")
  @Post(":slug/members")
  @HttpCode(200)
  async assignMember(@Req() req: Request, @Param("slug") slugRaw: string, @Body() body: unknown): Promise<ProjectMemberResult> {
    const input = parseOr422(ProjectMemberAssignSchema, body);
    const org = getOrg(req);
    const actor = getAuth(req);
    const current = await this.find(org.orgId, slugRaw);
    if (current.archived_at) throw new ConflictException({ statusCode: 409, message: "project_archived" });

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('project_members:' || $1::text))", [current.id]);

      const allowlist = await client.query("SELECT 1 FROM user_allowlist WHERE github_user_id = $1", [input.githubUserId]);
      if (allowlist.rowCount === 0) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          message: "user_not_allowlisted",
          issues: [{ path: "githubUserId", message: "user_not_allowlisted" }],
        });
      }

      const roleRes = await client.query(
        `SELECT 1 FROM role_bindings rb
           JOIN roles r ON r.id = rb.role_id AND r.org_id = rb.org_id
           JOIN users u ON u.id = rb.user_id
          WHERE rb.org_id = $1 AND u.github_user_id = $2 AND r.key = 'project_member'`,
        [org.orgId, input.githubUserId],
      );
      if (roleRes.rowCount === 0) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          message: "user_not_project_member",
          issues: [{ path: "githubUserId", message: "user_not_project_member" }],
        });
      }

      const userRow = await client.query<{ id: string; disabled_at: Date | null }>(
        "SELECT id, disabled_at FROM users WHERE github_user_id = $1",
        [input.githubUserId],
      );
      if (userRow.rows[0]?.disabled_at !== null) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          message: "user_disabled",
          issues: [{ path: "githubUserId", message: "user_disabled" }],
        });
      }
      const targetUserId = userRow.rows[0].id;

      const r = await client.query(
        `INSERT INTO project_assignments (org_id, project_id, user_id, access, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (project_id, user_id)
         DO UPDATE SET access = EXCLUDED.access
         WHERE project_assignments.access IS DISTINCT FROM EXCLUDED.access
         RETURNING project_id`,
        [org.orgId, current.id, targetUserId, input.access, actor.userId],
      );
      const changed = r.rowCount === 1;

      if (changed) {
        await writeAudit(client as unknown as Pool, {
          action: "project.member_assigned",
          orgId: org.orgId,
          actorUserId: actor.userId,
          actorGithubUserId: actor.githubUserId,
          targetType: "project",
          targetId: current.id,
          metadata: {
            slug: current.slug,
            githubUserId: String(input.githubUserId),
            access: input.access,
          },
        });
      }

      await client.query("COMMIT");
      return { changed };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  @RequirePermission("project:assign")
  @Delete(":slug/members")
  @HttpCode(200)
  async unassignMember(@Req() req: Request, @Param("slug") slugRaw: string, @Body() body: unknown): Promise<ProjectMemberResult> {
    const input = parseOr422(ProjectMemberUnassignSchema, body);
    const org = getOrg(req);
    const actor = getAuth(req);
    const current = await this.find(org.orgId, slugRaw);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('project_members:' || $1::text))", [current.id]);

      const r = await client.query(
        `DELETE FROM project_assignments pa
           USING users u
          WHERE pa.user_id = u.id AND pa.org_id = $1 AND pa.project_id = $2 AND u.github_user_id = $3
         RETURNING pa.project_id`,
        [org.orgId, current.id, input.githubUserId],
      );
      const changed = r.rowCount === 1;

      if (changed) {
        await writeAudit(client as unknown as Pool, {
          action: "project.member_unassigned",
          orgId: org.orgId,
          actorUserId: actor.userId,
          actorGithubUserId: actor.githubUserId,
          targetType: "project",
          targetId: current.id,
          metadata: {
            slug: current.slug,
            githubUserId: String(input.githubUserId),
          },
        });
      }

      await client.query("COMMIT");
      return { changed };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async find(orgId: string, slugRaw: string): Promise<ProjectRow> {
    if (!ProjectSlugSchema.safeParse(slugRaw).success) throw new NotFoundException();
    const r = await this.pool.query<ProjectRow>(`SELECT ${COLUMNS} FROM projects WHERE org_id = $1 AND slug = $2`, [orgId, slugRaw]);
    if (!r.rows[0]) throw new NotFoundException();
    return r.rows[0];
  }
}
