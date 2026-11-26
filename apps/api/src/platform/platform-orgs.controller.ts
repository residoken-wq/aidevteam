import { Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { OrgCreateSchema, OrgListQuerySchema, OrgUpdateSchema, SlugSchema, type Org } from "@aidevteam/contracts";
import type { Pool } from "@aidevteam/db";
import type { Request } from "express";
import { writeAudit } from "../audit";
import { getAuth } from "../rbac/auth-context";
import { RequirePlatformPermission } from "../rbac/decorators";
import { DB_POOL } from "../tokens";
import { parseOr422, rethrowConflict } from "../validation";

interface Row {
  id: string;
  slug: string;
  name: string;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

const COLUMNS = "id, slug, name, created_at, updated_at, archived_at";

const toDto = (r: Row): Org => ({
  slug: r.slug,
  name: r.name,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  archivedAt: r.archived_at ? r.archived_at.toISOString() : null,
});

/**
 * Org management for operator-granted platform admins (P2-03). Works across tenants by design, but only on the
 * orgs table: no members, roles or data inside an org are read or returned here. Archiving an org blocks every
 * request scoped to it (RbacService.memberships skips archived orgs); sessions are kept and data is retained.
 */
@Controller("platform/orgs")
export class PlatformOrgsController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePlatformPermission("platform:org:read")
  @Get()
  async list(@Query() query: unknown): Promise<{ items: Org[]; limit: number; offset: number }> {
    const q = parseOr422(OrgListQuerySchema, query);
    const r = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM orgs WHERE ($1::boolean OR archived_at IS NULL) ORDER BY slug LIMIT $2 OFFSET $3`,
      [q.archived === "true", q.limit, q.offset],
    );
    return { items: r.rows.map(toDto), limit: q.limit, offset: q.offset };
  }

  @RequirePlatformPermission("platform:org:read")
  @Get(":slug")
  async get(@Param("slug") slug: string): Promise<Org> {
    return toDto(await this.find(slug));
  }

  @RequirePlatformPermission("platform:org:write")
  @Post()
  @HttpCode(201)
  async create(@Req() req: Request, @Body() body: unknown): Promise<Org> {
    const input = parseOr422(OrgCreateSchema, body);
    let row: Row;
    try {
      row = (await this.pool.query<Row>(`INSERT INTO orgs (slug, name) VALUES ($1, $2) RETURNING ${COLUMNS}`, [input.slug, input.name])).rows[0]!;
    } catch (err) {
      rethrowConflict(err, "org_slug_taken");
    }
    await this.audit(req, "org.created", row);
    return toDto(row);
  }

  @RequirePlatformPermission("platform:org:write")
  @Patch(":slug")
  async update(@Req() req: Request, @Param("slug") slug: string, @Body() body: unknown): Promise<Org> {
    const input = parseOr422(OrgUpdateSchema, body);
    const current = await this.find(slug);
    const r = await this.pool.query<Row>(`UPDATE orgs SET name = $2, updated_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING ${COLUMNS}`, [
      current.id,
      input.name,
    ]);
    if (!r.rows[0]) throw new ConflictException({ statusCode: 409, message: "org_archived" });
    await this.audit(req, "org.updated", r.rows[0], { fields: "name" });
    return toDto(r.rows[0]);
  }

  @RequirePlatformPermission("platform:org:write")
  @Post(":slug/archive")
  @HttpCode(200)
  async archive(@Req() req: Request, @Param("slug") slug: string): Promise<Org> {
    const current = await this.find(slug);
    const r = await this.pool.query<Row>(
      `UPDATE orgs SET archived_at = now(), updated_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING ${COLUMNS}`,
      [current.id],
    );
    if (!r.rows[0]) throw new ConflictException({ statusCode: 409, message: "org_already_archived" });
    await this.audit(req, "org.archived", r.rows[0]);
    return toDto(r.rows[0]);
  }

  @RequirePlatformPermission("platform:org:write")
  @Post(":slug/restore")
  @HttpCode(200)
  async restore(@Req() req: Request, @Param("slug") slug: string): Promise<Org> {
    const current = await this.find(slug);
    const r = await this.pool.query<Row>(
      `UPDATE orgs SET archived_at = NULL, updated_at = now() WHERE id = $1 AND archived_at IS NOT NULL RETURNING ${COLUMNS}`,
      [current.id],
    );
    if (!r.rows[0]) throw new ConflictException({ statusCode: 409, message: "org_not_archived" });
    await this.audit(req, "org.restored", r.rows[0]);
    return toDto(r.rows[0]);
  }

  private async find(slug: string): Promise<Row> {
    if (!SlugSchema.safeParse(slug).success) throw new NotFoundException();
    const r = await this.pool.query<Row>(`SELECT ${COLUMNS} FROM orgs WHERE slug = $1`, [slug]);
    if (!r.rows[0]) throw new NotFoundException();
    return r.rows[0];
  }

  private async audit(req: Request, action: string, row: Row, extra: Record<string, string> = {}): Promise<void> {
    const actor = getAuth(req);
    await writeAudit(this.pool, {
      action,
      orgId: row.id,
      actorUserId: actor.userId,
      actorGithubUserId: actor.githubUserId,
      targetType: "org",
      targetId: row.id,
      metadata: { slug: row.slug, via: "platform", ...extra },
    });
  }
}
