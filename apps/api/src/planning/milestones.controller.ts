import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  ListQuerySchema,
  MilestoneCreateSchema,
  MilestoneUpdateSchema,
  SlugSchema,
  type Milestone,
} from "@aidevteam/contracts";
import type { Pool, PoolClient } from "@aidevteam/db";
import type { Request } from "express";
import { writeAudit } from "../audit";
import { getAuth, getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { verifyProjectScope } from "../rbac/project-scope";
import { DB_POOL } from "../tokens";
import { parseOr422 } from "../validation";

interface MilestoneRow {
  id: string;
  slug: string;
  project_slug: string;
  title: string;
  due_date: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

const SELECT = `SELECT m.id, m.slug, p.slug AS project_slug, m.title,
                       to_char(m.due_date, 'YYYY-MM-DD') AS due_date,
                       m.created_at, m.updated_at, m.archived_at
                  FROM milestones m
                  JOIN projects p ON p.id = m.project_id AND p.org_id = m.org_id`;

const toDto = (r: MilestoneRow): Milestone => ({
  slug: r.slug,
  projectSlug: r.project_slug,
  title: r.title,
  dueDate: r.due_date,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  archivedAt: r.archived_at ? r.archived_at.toISOString() : null,
});

@Controller("projects/:slug/milestones")
export class MilestonesController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("project:read")
  @Get()
  async list(
    @Req() req: Request,
    @Param("slug") slug: string,
    @Query() query: unknown,
  ): Promise<{ items: Milestone[]; limit: number; offset: number }> {
    const q = parseOr422(ListQuerySchema, query);
    const org = getOrg(req);
    const project = await this.project(this.pool, req, slug, "read");
    const r = await this.pool.query<MilestoneRow>(
      `${SELECT} WHERE m.org_id = $1 AND m.project_id = $2 AND ($3::boolean OR m.archived_at IS NULL)
        ORDER BY m.created_at DESC, m.id LIMIT $4 OFFSET $5`,
      [org.orgId, project.id, q.archived === "true", q.limit, q.offset],
    );
    return { items: r.rows.map(toDto), limit: q.limit, offset: q.offset };
  }

  @RequirePermission("project:read")
  @Get(":milestoneSlug")
  async get(
    @Req() req: Request,
    @Param("slug") slug: string,
    @Param("milestoneSlug") milestoneSlug: string,
  ): Promise<Milestone> {
    const org = getOrg(req);
    const project = await this.project(this.pool, req, slug, "read");
    const row = await this.find(this.pool, org.orgId, project.id, milestoneSlug);
    return toDto(row);
  }

  @RequirePermission("project:write")
  @Post()
  @HttpCode(201)
  async create(
    @Req() req: Request,
    @Param("slug") slug: string,
    @Body() body: unknown,
  ): Promise<Milestone> {
    const input = parseOr422(MilestoneCreateSchema, body);
    const org = getOrg(req);
    const auth = getAuth(req);

    const row = await this.tx(async (c) => {
      const project = await this.writableProject(c, req, slug);
      const existing = await c.query("SELECT 1 FROM milestones WHERE org_id = $1 AND project_id = $2 AND slug = $3", [
        org.orgId,
        project.id,
        input.slug,
      ]);
      if (existing.rowCount && existing.rowCount > 0) {
        throw new ConflictException({ statusCode: 409, message: "milestone_slug_already_exists" });
      }

      const r = await c.query<{ id: string }>(
        `INSERT INTO milestones (org_id, project_id, slug, title, due_date, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [org.orgId, project.id, input.slug, input.title, input.dueDate ?? null, auth.userId],
      );

      const created = await this.findById(c, org.orgId, r.rows[0]!.id);
      await writeAudit(c, {
        action: "milestone.created",
        orgId: org.orgId,
        actorUserId: auth.userId,
        actorGithubUserId: auth.githubUserId,
        targetType: "milestone",
        targetId: created.id,
        metadata: { project: slug, milestone: created.slug },
      });
      return created;
    });

    return toDto(row);
  }

  @RequirePermission("project:write")
  @Patch(":milestoneSlug")
  async update(
    @Req() req: Request,
    @Param("slug") slug: string,
    @Param("milestoneSlug") milestoneSlug: string,
    @Body() body: unknown,
  ): Promise<Milestone> {
    const input = parseOr422(MilestoneUpdateSchema, body);
    const org = getOrg(req);
    const auth = getAuth(req);

    const row = await this.tx(async (c) => {
      const project = await this.writableProject(c, req, slug);
      const current = await this.find(c, org.orgId, project.id, milestoneSlug);
      if (current.archived_at) {
        throw new ConflictException({ statusCode: 409, message: "milestone_archived" });
      }

      await c.query(
        `UPDATE milestones
            SET title = COALESCE($3, title),
                due_date = CASE WHEN $4::boolean THEN $5::date ELSE due_date END,
                updated_at = now()
          WHERE org_id = $1 AND id = $2 AND archived_at IS NULL`,
        [
          org.orgId,
          current.id,
          input.title ?? null,
          input.dueDate !== undefined,
          input.dueDate ?? null,
        ],
      );

      const updated = await this.findById(c, org.orgId, current.id);
      await writeAudit(c, {
        action: "milestone.updated",
        orgId: org.orgId,
        actorUserId: auth.userId,
        actorGithubUserId: auth.githubUserId,
        targetType: "milestone",
        targetId: updated.id,
        metadata: { project: slug, milestone: updated.slug, fields: Object.keys(input).sort().join(",") },
      });
      return updated;
    });

    return toDto(row);
  }

  @RequirePermission("project:write")
  @Post(":milestoneSlug/archive")
  @HttpCode(200)
  async archive(
    @Req() req: Request,
    @Param("slug") slug: string,
    @Param("milestoneSlug") milestoneSlug: string,
  ): Promise<Milestone> {
    const org = getOrg(req);
    const auth = getAuth(req);

    const row = await this.tx(async (c) => {
      const project = await this.writableProject(c, req, slug);
      const current = await this.find(c, org.orgId, project.id, milestoneSlug);
      if (current.archived_at) {
        throw new ConflictException({ statusCode: 409, message: "milestone_already_archived" });
      }

      await c.query(
        "UPDATE milestones SET archived_at = now(), updated_at = now() WHERE org_id = $1 AND id = $2",
        [org.orgId, current.id],
      );

      const updated = await this.findById(c, org.orgId, current.id);
      await writeAudit(c, {
        action: "milestone.archived",
        orgId: org.orgId,
        actorUserId: auth.userId,
        actorGithubUserId: auth.githubUserId,
        targetType: "milestone",
        targetId: updated.id,
        metadata: { project: slug, milestone: updated.slug },
      });
      return updated;
    });

    return toDto(row);
  }

  private async project(c: PoolClient | Pool, req: Request, slug: string, requiredAccess: "read" | "write" = "read") {
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
    return p;
  }

  private async writableProject(c: PoolClient | Pool, req: Request, slug: string) {
    const p = await this.project(c, req, slug, "write");
    const r = await c.query<{ archived: boolean }>("SELECT archived_at IS NOT NULL AS archived FROM projects WHERE id = $1", [p.id]);
    if (r.rows[0]?.archived) throw new ConflictException({ statusCode: 409, message: "project_archived" });
    return p;
  }

  private async find(c: PoolClient | Pool, orgId: string, projectId: string, milestoneSlug: string): Promise<MilestoneRow> {
    if (!SlugSchema.safeParse(milestoneSlug).success) throw new NotFoundException();
    const r = await c.query<MilestoneRow>(`${SELECT} WHERE m.org_id = $1 AND m.project_id = $2 AND m.slug = $3`, [
      orgId,
      projectId,
      milestoneSlug,
    ]);
    if (!r.rows[0]) throw new NotFoundException();
    return r.rows[0];
  }

  private async findById(c: PoolClient | Pool, orgId: string, id: string): Promise<MilestoneRow> {
    const r = await c.query<MilestoneRow>(`${SELECT} WHERE m.org_id = $1 AND m.id = $2`, [orgId, id]);
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
}
