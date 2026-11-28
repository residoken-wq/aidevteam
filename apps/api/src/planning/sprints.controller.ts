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
  ListQuerySchema,
  SlugSchema,
  SprintCreateSchema,
  SprintTransitionSchema,
  SprintUpdateSchema,
  type Sprint,
} from "@aidevteam/contracts";
import type { Pool, PoolClient } from "@aidevteam/db";
import type { Request } from "express";
import { writeAudit } from "../audit";
import { getAuth, getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { verifyProjectScope } from "../rbac/project-scope";
import { DB_POOL } from "../tokens";
import { parseOr422 } from "../validation";

interface SprintRow {
  id: string;
  number: number;
  project_slug: string;
  name: string;
  start_date: string;
  end_date: string;
  status: Sprint["status"];
  created_at: Date;
  updated_at: Date;
}

const SELECT = `SELECT s.id, s.number, p.slug AS project_slug, s.name,
                       to_char(s.start_date, 'YYYY-MM-DD') AS start_date,
                       to_char(s.end_date, 'YYYY-MM-DD') AS end_date,
                       s.status, s.created_at, s.updated_at
                  FROM sprints s
                  JOIN projects p ON p.id = s.project_id AND p.org_id = s.org_id`;

const toDto = (r: SprintRow): Sprint => ({
  number: r.number,
  projectSlug: r.project_slug,
  name: r.name,
  startDate: r.start_date,
  endDate: r.end_date,
  status: r.status,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const NUMBER_RE = /^[1-9][0-9]{0,8}$/;
const unprocessable = (path: string, message: string) =>
  new UnprocessableEntityException({ statusCode: 422, message: "validation_failed", issues: [{ path, message }] });

@Controller("projects/:slug/sprints")
export class SprintsController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("project:read")
  @Get()
  async list(
    @Req() req: Request,
    @Param("slug") slug: string,
    @Query() query: unknown,
  ): Promise<{ items: Sprint[]; limit: number; offset: number }> {
    const q = parseOr422(ListQuerySchema, query);
    const org = getOrg(req);
    const project = await this.project(this.pool, req, slug, "read");
    const r = await this.pool.query<SprintRow>(
      `${SELECT} WHERE s.org_id = $1 AND s.project_id = $2
        ORDER BY s.number ASC LIMIT $3 OFFSET $4`,
      [org.orgId, project.id, q.limit, q.offset],
    );
    return { items: r.rows.map(toDto), limit: q.limit, offset: q.offset };
  }

  @RequirePermission("project:read")
  @Get(":number")
  async get(
    @Req() req: Request,
    @Param("slug") slug: string,
    @Param("number") number: string,
  ): Promise<Sprint> {
    const org = getOrg(req);
    const project = await this.project(this.pool, req, slug, "read");
    const row = await this.find(this.pool, org.orgId, project.id, number);
    return toDto(row);
  }

  @RequirePermission("project:write")
  @Post()
  @HttpCode(201)
  async create(
    @Req() req: Request,
    @Param("slug") slug: string,
    @Body() body: unknown,
  ): Promise<Sprint> {
    const input = parseOr422(SprintCreateSchema, body);
    const org = getOrg(req);
    const auth = getAuth(req);

    const row = await this.tx(async (c) => {
      const project = await this.writableProject(c, req, slug);
      await c.query("SELECT pg_advisory_xact_lock(hashtext('sprints:' || $1::text))", [project.id]);

      const r = await c.query<{ id: string }>(
        `INSERT INTO sprints (org_id, project_id, number, name, start_date, end_date, status, created_by_user_id)
         SELECT $1, $2, COALESCE(MAX(number), 0) + 1, $3, $4, $5, 'PLANNED', $6
           FROM sprints WHERE project_id = $2
         RETURNING id`,
        [org.orgId, project.id, input.name, input.startDate, input.endDate, auth.userId],
      );

      const created = await this.findById(c, org.orgId, r.rows[0]!.id);
      await writeAudit(c, {
        action: "sprint.created",
        orgId: org.orgId,
        actorUserId: auth.userId,
        actorGithubUserId: auth.githubUserId,
        targetType: "sprint",
        targetId: created.id,
        metadata: { project: slug, number: String(created.number) },
      });
      return created;
    });

    return toDto(row);
  }

  @RequirePermission("project:write")
  @Patch(":number")
  async update(
    @Req() req: Request,
    @Param("slug") slug: string,
    @Param("number") number: string,
    @Body() body: unknown,
  ): Promise<Sprint> {
    const input = parseOr422(SprintUpdateSchema, body);
    const org = getOrg(req);
    const auth = getAuth(req);

    const row = await this.tx(async (c) => {
      const project = await this.writableProject(c, req, slug);
      const current = await this.find(c, org.orgId, project.id, number);
      if (current.status === "CLOSED") {
        throw unprocessable("status", "cannot edit a closed sprint");
      }

      const effectiveStart = input.startDate ?? current.start_date;
      const effectiveEnd = input.endDate ?? current.end_date;
      if (effectiveEnd < effectiveStart) {
        throw unprocessable("endDate", "end_date must be greater than or equal to start_date");
      }

      await c.query(
        `UPDATE sprints
            SET name = COALESCE($3, name),
                start_date = COALESCE($4, start_date),
                end_date = COALESCE($5, end_date),
                updated_at = now()
          WHERE org_id = $1 AND id = $2`,
        [
          org.orgId,
          current.id,
          input.name ?? null,
          input.startDate ?? null,
          input.endDate ?? null,
        ],
      );

      const updated = await this.findById(c, org.orgId, current.id);
      await writeAudit(c, {
        action: "sprint.updated",
        orgId: org.orgId,
        actorUserId: auth.userId,
        actorGithubUserId: auth.githubUserId,
        targetType: "sprint",
        targetId: updated.id,
        metadata: { project: slug, number: String(updated.number), fields: Object.keys(input).sort().join(",") },
      });
      return updated;
    });

    return toDto(row);
  }

  @RequirePermission("project:write")
  @Post(":number/transitions")
  @HttpCode(200)
  async transition(
    @Req() req: Request,
    @Param("slug") slug: string,
    @Param("number") number: string,
    @Body() body: unknown,
  ): Promise<Sprint> {
    const input = parseOr422(SprintTransitionSchema, body);
    const org = getOrg(req);
    const auth = getAuth(req);

    const row = await this.tx(async (c) => {
      const project = await this.writableProject(c, req, slug);
      const current = await this.find(c, org.orgId, project.id, number);

      if (current.status === "PLANNED") {
        if (input.to !== "ACTIVE") {
          throw unprocessable("to", "cannot jump from PLANNED to CLOSED");
        }
        // Check if there is already an ACTIVE sprint in this project
        const active = await c.query<{ number: number }>(
          "SELECT number FROM sprints WHERE project_id = $1 AND status = 'ACTIVE' AND id <> $2",
          [project.id, current.id],
        );
        if (active.rowCount && active.rowCount > 0) {
          throw new ConflictException({
            statusCode: 409,
            message: "another_sprint_is_already_active",
          });
        }
      } else if (current.status === "ACTIVE") {
        if (input.to !== "CLOSED") {
          throw new ConflictException({ statusCode: 409, message: "sprint_already_active" });
        }
      } else if (current.status === "CLOSED") {
        throw unprocessable("to", "closed sprints cannot be reopened");
      }

      await c.query(
        "UPDATE sprints SET status = $3, updated_at = now() WHERE org_id = $1 AND id = $2",
        [org.orgId, current.id, input.to],
      );

      const updated = await this.findById(c, org.orgId, current.id);
      await writeAudit(c, {
        action: "sprint.transitioned",
        orgId: org.orgId,
        actorUserId: auth.userId,
        actorGithubUserId: auth.githubUserId,
        targetType: "sprint",
        targetId: updated.id,
        metadata: {
          project: slug,
          number: String(updated.number),
          from: current.status,
          to: input.to,
        },
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

  private async find(c: PoolClient | Pool, orgId: string, projectId: string, number: string): Promise<SprintRow> {
    if (!NUMBER_RE.test(number)) throw new NotFoundException();
    const r = await c.query<SprintRow>(`${SELECT} WHERE s.org_id = $1 AND s.project_id = $2 AND s.number = $3`, [
      orgId,
      projectId,
      Number(number),
    ]);
    if (!r.rows[0]) throw new NotFoundException();
    return r.rows[0];
  }

  private async findById(c: PoolClient | Pool, orgId: string, id: string): Promise<SprintRow> {
    const r = await c.query<SprintRow>(`${SELECT} WHERE s.org_id = $1 AND s.id = $2`, [orgId, id]);
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
