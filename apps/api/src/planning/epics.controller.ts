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
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  EpicCreateSchema,
  EpicSchema,
  EpicUpdateSchema,
  ListQuerySchema,
  SlugSchema,
  type Epic,
} from "@aidevteam/contracts";
import type { Pool, PoolClient } from "@aidevteam/db";
import type { Request } from "express";
import { writeAudit } from "../audit";
import { getAuth, getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { verifyProjectScope } from "../rbac/project-scope";
import { DB_POOL } from "../tokens";
import { parseOr422 } from "../validation";

interface EpicRow {
  id: string;
  slug: string;
  project_slug: string;
  title: string;
  description: string | null;
  milestone_slug: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

const SELECT = `SELECT e.id, e.slug, p.slug AS project_slug, e.title, e.description,
                       m.slug AS milestone_slug, e.created_at, e.updated_at, e.archived_at
                  FROM epics e
                  JOIN projects p ON p.id = e.project_id AND p.org_id = e.org_id
                  LEFT JOIN milestones m ON m.id = e.milestone_id AND m.project_id = e.project_id`;

const toDto = (r: EpicRow): Epic => ({
  slug: r.slug,
  projectSlug: r.project_slug,
  title: r.title,
  description: r.description,
  milestoneSlug: r.milestone_slug,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  archivedAt: r.archived_at ? r.archived_at.toISOString() : null,
});

const unprocessable = (path: string, message: string) =>
  new UnprocessableEntityException({ statusCode: 422, message: "validation_failed", issues: [{ path, message }] });

@Controller("projects/:slug/epics")
export class EpicsController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("project:read")
  @Get()
  async list(
    @Req() req: Request,
    @Param("slug") slug: string,
    @Query() query: unknown,
  ): Promise<{ items: Epic[]; limit: number; offset: number }> {
    const q = parseOr422(ListQuerySchema, query);
    const org = getOrg(req);
    const project = await this.project(this.pool, req, slug, "read");
    const r = await this.pool.query<EpicRow>(
      `${SELECT} WHERE e.org_id = $1 AND e.project_id = $2 AND ($3::boolean OR e.archived_at IS NULL)
        ORDER BY e.created_at DESC, e.id LIMIT $4 OFFSET $5`,
      [org.orgId, project.id, q.archived === "true", q.limit, q.offset],
    );
    return { items: r.rows.map(toDto), limit: q.limit, offset: q.offset };
  }

  @RequirePermission("project:read")
  @Get(":epicSlug")
  async get(
    @Req() req: Request,
    @Param("slug") slug: string,
    @Param("epicSlug") epicSlug: string,
  ): Promise<Epic> {
    const org = getOrg(req);
    const project = await this.project(this.pool, req, slug, "read");
    const row = await this.find(this.pool, org.orgId, project.id, epicSlug);
    return toDto(row);
  }

  @RequirePermission("project:write")
  @Post()
  @HttpCode(201)
  async create(
    @Req() req: Request,
    @Param("slug") slug: string,
    @Body() body: unknown,
  ): Promise<Epic> {
    const input = parseOr422(EpicCreateSchema, body);
    const org = getOrg(req);
    const auth = getAuth(req);

    const row = await this.tx(async (c) => {
      const project = await this.writableProject(c, req, slug);
      const existing = await c.query("SELECT 1 FROM epics WHERE org_id = $1 AND project_id = $2 AND slug = $3", [
        org.orgId,
        project.id,
        input.slug,
      ]);
      if (existing.rowCount && existing.rowCount > 0) {
        throw new ConflictException({ statusCode: 409, message: "epic_slug_already_exists" });
      }

      let milestoneId: string | null = null;
      if (input.milestoneSlug) {
        milestoneId = await this.resolveMilestoneId(c, org.orgId, project.id, input.milestoneSlug);
      }

      const r = await c.query<{ id: string }>(
        `INSERT INTO epics (org_id, project_id, slug, title, description, milestone_id, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [org.orgId, project.id, input.slug, input.title, input.description ?? null, milestoneId, auth.userId],
      );

      const created = await this.findById(c, org.orgId, r.rows[0]!.id);
      await writeAudit(c, {
        action: "epic.created",
        orgId: org.orgId,
        actorUserId: auth.userId,
        actorGithubUserId: auth.githubUserId,
        targetType: "epic",
        targetId: created.id,
        metadata: { project: slug, epic: created.slug },
      });
      return created;
    });

    return toDto(row);
  }

  @RequirePermission("project:write")
  @Patch(":epicSlug")
  async update(
    @Req() req: Request,
    @Param("slug") slug: string,
    @Param("epicSlug") epicSlug: string,
    @Body() body: unknown,
  ): Promise<Epic> {
    const input = parseOr422(EpicUpdateSchema, body);
    const org = getOrg(req);
    const auth = getAuth(req);

    const row = await this.tx(async (c) => {
      const project = await this.writableProject(c, req, slug);
      const current = await this.find(c, org.orgId, project.id, epicSlug);
      if (current.archived_at) {
        throw new ConflictException({ statusCode: 409, message: "epic_archived" });
      }

      let milestoneId: string | null | undefined = undefined;
      if (input.milestoneSlug !== undefined) {
        if (input.milestoneSlug === null) {
          milestoneId = null;
        } else {
          milestoneId = await this.resolveMilestoneId(c, org.orgId, project.id, input.milestoneSlug);
        }
      }

      await c.query(
        `UPDATE epics
            SET title = COALESCE($3, title),
                description = CASE WHEN $4::boolean THEN $5 ELSE description END,
                milestone_id = CASE WHEN $6::boolean THEN $7::uuid ELSE milestone_id END,
                updated_at = now()
          WHERE org_id = $1 AND id = $2 AND archived_at IS NULL`,
        [
          org.orgId,
          current.id,
          input.title ?? null,
          input.description !== undefined,
          input.description ?? null,
          milestoneId !== undefined,
          milestoneId ?? null,
        ],
      );

      const updated = await this.findById(c, org.orgId, current.id);
      await writeAudit(c, {
        action: "epic.updated",
        orgId: org.orgId,
        actorUserId: auth.userId,
        actorGithubUserId: auth.githubUserId,
        targetType: "epic",
        targetId: updated.id,
        metadata: { project: slug, epic: updated.slug, fields: Object.keys(input).sort().join(",") },
      });
      return updated;
    });

    return toDto(row);
  }

  @RequirePermission("project:write")
  @Post(":epicSlug/archive")
  @HttpCode(200)
  async archive(
    @Req() req: Request,
    @Param("slug") slug: string,
    @Param("epicSlug") epicSlug: string,
  ): Promise<Epic> {
    const org = getOrg(req);
    const auth = getAuth(req);

    const row = await this.tx(async (c) => {
      const project = await this.writableProject(c, req, slug);
      const current = await this.find(c, org.orgId, project.id, epicSlug);
      if (current.archived_at) {
        throw new ConflictException({ statusCode: 409, message: "epic_already_archived" });
      }

      await c.query(
        "UPDATE epics SET archived_at = now(), updated_at = now() WHERE org_id = $1 AND id = $2",
        [org.orgId, current.id],
      );

      const updated = await this.findById(c, org.orgId, current.id);
      await writeAudit(c, {
        action: "epic.archived",
        orgId: org.orgId,
        actorUserId: auth.userId,
        actorGithubUserId: auth.githubUserId,
        targetType: "epic",
        targetId: updated.id,
        metadata: { project: slug, epic: updated.slug },
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

  private async resolveMilestoneId(c: PoolClient, orgId: string, projectId: string, milestoneSlug: string): Promise<string> {
    const r = await c.query<{ id: string; archived_at: Date | null }>(
      "SELECT id, archived_at FROM milestones WHERE org_id = $1 AND project_id = $2 AND slug = $3",
      [orgId, projectId, milestoneSlug],
    );
    if (!r.rows[0]) throw unprocessable("milestoneSlug", "unknown milestone in this project");
    if (r.rows[0].archived_at) throw unprocessable("milestoneSlug", "cannot assign archived milestone");
    return r.rows[0].id;
  }

  private async find(c: PoolClient | Pool, orgId: string, projectId: string, epicSlug: string): Promise<EpicRow> {
    if (!SlugSchema.safeParse(epicSlug).success) throw new NotFoundException();
    const r = await c.query<EpicRow>(`${SELECT} WHERE e.org_id = $1 AND e.project_id = $2 AND e.slug = $3`, [
      orgId,
      projectId,
      epicSlug,
    ]);
    if (!r.rows[0]) throw new NotFoundException();
    return r.rows[0];
  }

  private async findById(c: PoolClient | Pool, orgId: string, id: string): Promise<EpicRow> {
    const r = await c.query<EpicRow>(`${SELECT} WHERE e.org_id = $1 AND e.id = $2`, [orgId, id]);
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
