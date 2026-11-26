import { Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query, Req, UnprocessableEntityException } from "@nestjs/common";
import { AgentCreateSchema, AgentListQuerySchema, AgentUpdateSchema, SlugSchema, type Agent } from "@aidevteam/contracts";
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
  title: string | null;
  model: string | null;
  provider_account_slug: string | null;
  reports_to_slug: string | null;
  enabled: boolean;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

const SELECT = `SELECT a.id, a.slug, a.name, a.title, a.model, pa.slug AS provider_account_slug, m.slug AS reports_to_slug,
                       a.enabled, a.description, a.created_at, a.updated_at, a.archived_at
                  FROM agents a
                  LEFT JOIN provider_accounts pa ON pa.id = a.provider_account_id AND pa.org_id = a.org_id
                  LEFT JOIN agents m ON m.id = a.reports_to_agent_id AND m.org_id = a.org_id`;

const toDto = (r: Row): Agent => ({
  slug: r.slug,
  name: r.name,
  title: r.title,
  model: r.model,
  providerAccountSlug: r.provider_account_slug,
  reportsToSlug: r.reports_to_slug,
  enabled: r.enabled,
  description: r.description,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  archivedAt: r.archived_at ? r.archived_at.toISOString() : null,
});

const unprocessable = (path: string, message: string) => new UnprocessableEntityException({ statusCode: 422, message: "validation_failed", issues: [{ path, message }] });

/**
 * Agents of the session's org (P2-05). Provider account and manager are resolved by slug inside the session's org
 * only (another org's object looks the same as a missing one); same-org FKs back this up in the DB. Writes run
 * under an org-level advisory lock so two concurrent manager changes cannot create a reporting cycle.
 */
@Controller("agents")
export class AgentsController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("agent:read")
  @Get()
  async list(@Req() req: Request, @Query() query: unknown): Promise<{ items: Agent[]; limit: number; offset: number }> {
    const q = parseOr422(AgentListQuerySchema, query);
    const r = await this.pool.query<Row>(
      `${SELECT} WHERE a.org_id = $1 AND ($2::boolean OR a.archived_at IS NULL) ORDER BY a.created_at DESC, a.id LIMIT $3 OFFSET $4`,
      [getOrg(req).orgId, q.archived === "true", q.limit, q.offset],
    );
    return { items: r.rows.map(toDto), limit: q.limit, offset: q.offset };
  }

  @RequirePermission("agent:read")
  @Get(":slug")
  async get(@Req() req: Request, @Param("slug") slug: string): Promise<Agent> {
    return toDto(await this.find(this.pool, getOrg(req).orgId, slug));
  }

  @RequirePermission("agent:write")
  @Post()
  @HttpCode(201)
  async create(@Req() req: Request, @Body() body: unknown): Promise<Agent> {
    const input = parseOr422(AgentCreateSchema, body);
    const org = getOrg(req);
    const row = await this.locked(org.orgId, async (c) => {
      const providerId = input.providerAccountSlug ? await this.providerAccountId(c, org.orgId, input.providerAccountSlug) : null;
      const managerId = input.reportsToSlug ? await this.managerId(c, org.orgId, input.reportsToSlug) : null;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO agents (org_id, slug, name, title, model, provider_account_id, reports_to_agent_id, description, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [org.orgId, input.slug, input.name, input.title ?? null, input.model ?? null, providerId, managerId, input.description ?? null, getAuth(req).userId],
        );
        return this.findById(c, org.orgId, r.rows[0]!.id);
      } catch (err) {
        rethrowConflict(err, "agent_slug_taken");
      }
    });
    await this.audit(req, "agent.created", row, {});
    return toDto(row);
  }

  @RequirePermission("agent:write")
  @Patch(":slug")
  async update(@Req() req: Request, @Param("slug") slug: string, @Body() body: unknown): Promise<Agent> {
    const input = parseOr422(AgentUpdateSchema, body);
    const org = getOrg(req);
    const row = await this.locked(org.orgId, async (c) => {
      const current = await this.find(c, org.orgId, slug);
      if (current.archived_at) throw new ConflictException({ statusCode: 409, message: "agent_archived" });
      const providerId =
        input.providerAccountSlug === undefined ? undefined : input.providerAccountSlug === null ? null : await this.providerAccountId(c, org.orgId, input.providerAccountSlug);
      let managerId: string | null | undefined;
      if (input.reportsToSlug === undefined) managerId = undefined;
      else if (input.reportsToSlug === null) managerId = null;
      else {
        managerId = await this.managerId(c, org.orgId, input.reportsToSlug);
        if (await this.wouldCycle(c, org.orgId, current.id, managerId)) throw new ConflictException({ statusCode: 409, message: "agent_reporting_cycle" });
      }
      await c.query(
        `UPDATE agents
            SET name = COALESCE($3, name),
                enabled = COALESCE($4, enabled),
                title = CASE WHEN $5::boolean THEN $6 ELSE title END,
                model = CASE WHEN $7::boolean THEN $8 ELSE model END,
                provider_account_id = CASE WHEN $9::boolean THEN $10::uuid ELSE provider_account_id END,
                reports_to_agent_id = CASE WHEN $11::boolean THEN $12::uuid ELSE reports_to_agent_id END,
                description = CASE WHEN $13::boolean THEN $14 ELSE description END,
                updated_at = now()
          WHERE org_id = $1 AND id = $2 AND archived_at IS NULL`,
        [
          org.orgId,
          current.id,
          input.name ?? null,
          input.enabled ?? null,
          input.title !== undefined,
          input.title ?? null,
          input.model !== undefined,
          input.model ?? null,
          providerId !== undefined,
          providerId ?? null,
          managerId !== undefined,
          managerId ?? null,
          input.description !== undefined,
          input.description ?? null,
        ],
      );
      return this.findById(c, org.orgId, current.id);
    });
    await this.audit(req, "agent.updated", row, { fields: Object.keys(input).sort().join(",") });
    return toDto(row);
  }

  @RequirePermission("agent:write")
  @Post(":slug/archive")
  @HttpCode(200)
  async archive(@Req() req: Request, @Param("slug") slug: string): Promise<Agent> {
    const org = getOrg(req);
    const row = await this.locked(org.orgId, async (c) => {
      const current = await this.find(c, org.orgId, slug);
      if (current.archived_at) throw new ConflictException({ statusCode: 409, message: "agent_already_archived" });
      const reports = await c.query("SELECT 1 FROM agents WHERE org_id = $1 AND reports_to_agent_id = $2 AND archived_at IS NULL LIMIT 1", [org.orgId, current.id]);
      if (reports.rowCount) throw new ConflictException({ statusCode: 409, message: "agent_has_reports" });
      await c.query("UPDATE agents SET archived_at = now(), enabled = false, updated_at = now() WHERE org_id = $1 AND id = $2", [org.orgId, current.id]);
      return this.findById(c, org.orgId, current.id);
    });
    await this.audit(req, "agent.archived", row, {});
    return toDto(row);
  }

  private async providerAccountId(c: PoolClient, orgId: string, slug: string): Promise<string> {
    const r = await c.query<{ id: string }>("SELECT id FROM provider_accounts WHERE org_id = $1 AND slug = $2 AND archived_at IS NULL", [orgId, slug]);
    if (!r.rows[0]) throw unprocessable("providerAccountSlug", "unknown or archived provider account");
    return r.rows[0].id;
  }

  private async managerId(c: PoolClient, orgId: string, slug: string): Promise<string> {
    const r = await c.query<{ id: string }>("SELECT id FROM agents WHERE org_id = $1 AND slug = $2 AND archived_at IS NULL", [orgId, slug]);
    if (!r.rows[0]) throw unprocessable("reportsToSlug", "unknown or archived agent");
    return r.rows[0].id;
  }

  /** True if `agentId` would end up above itself: the new manager is the agent or one of its (transitive) reports. */
  private async wouldCycle(c: PoolClient, orgId: string, agentId: string, managerId: string): Promise<boolean> {
    const r = await c.query(
      `WITH RECURSIVE chain(id, depth) AS (
         SELECT $3::uuid, 0
         UNION ALL
         SELECT a.reports_to_agent_id, chain.depth + 1
           FROM agents a JOIN chain ON a.id = chain.id
          WHERE a.org_id = $1 AND a.reports_to_agent_id IS NOT NULL AND chain.depth < 1000
       )
       SELECT 1 FROM chain WHERE id = $2 LIMIT 1`,
      [orgId, agentId, managerId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  private async locked<T>(orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtext('agents:' || $1::text))", [orgId]);
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
      targetType: "agent",
      targetId: row.id,
      metadata: { slug: row.slug, ...extra },
    });
  }

  private async find(c: PoolClient | Pool, orgId: string, slug: string): Promise<Row> {
    if (!SlugSchema.safeParse(slug).success) throw new NotFoundException();
    const r = await c.query<Row>(`${SELECT} WHERE a.org_id = $1 AND a.slug = $2`, [orgId, slug]);
    if (!r.rows[0]) throw new NotFoundException();
    return r.rows[0];
  }

  private async findById(c: PoolClient | Pool, orgId: string, id: string): Promise<Row> {
    const r = await c.query<Row>(`${SELECT} WHERE a.org_id = $1 AND a.id = $2`, [orgId, id]);
    return r.rows[0]!;
  }
}
