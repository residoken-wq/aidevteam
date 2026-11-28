import { Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import {
  ProviderAccountCreateSchema,
  ProviderAccountLicenseChangeSchema,
  ProviderAccountListQuerySchema,
  ProviderAccountUpdateSchema,
  SlugSchema,
  type ProviderAccount,
} from "@aidevteam/contracts";
import type { Pool } from "@aidevteam/db";
import type { Request } from "express";
import type { z } from "zod";
import { writeAudit } from "../audit";
import { getAuth, getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { DB_POOL } from "../tokens";
import { parseOr422, rethrowConflict } from "../validation";

interface Row {
  id: string;
  slug: string;
  name: string;
  provider: ProviderAccount["provider"];
  secret_ref: string;
  description: string | null;
  license_status: ProviderAccount["licenseStatus"];
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

const COLUMNS = "id, slug, name, provider, secret_ref, description, license_status, created_at, updated_at, archived_at";

const toDto = (r: Row): ProviderAccount => ({
  slug: r.slug,
  name: r.name,
  provider: r.provider,
  secretRef: r.secret_ref,
  description: r.description,
  licenseStatus: r.license_status,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  archivedAt: r.archived_at ? r.archived_at.toISOString() : null,
});

/**
 * Provider accounts of the session's org (P2-07). Stores secret references only; never contacts the provider.
 * Same tenant rules as projects: every statement filters on the session org; other orgs → 404; archive only.
 */
@Controller("provider-accounts")
export class ProviderAccountsController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("provider_account:read")
  @Get()
  async list(@Req() req: Request, @Query() query: unknown): Promise<{ items: ProviderAccount[]; limit: number; offset: number }> {
    const q = parseOr422(ProviderAccountListQuerySchema, query);
    const r = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM provider_accounts
        WHERE org_id = $1 AND ($2::boolean OR archived_at IS NULL)
        ORDER BY created_at DESC, id LIMIT $3 OFFSET $4`,
      [getOrg(req).orgId, q.archived === "true", q.limit, q.offset],
    );
    return { items: r.rows.map(toDto), limit: q.limit, offset: q.offset };
  }

  @RequirePermission("provider_account:read")
  @Get(":slug")
  async get(@Req() req: Request, @Param("slug") slug: string): Promise<ProviderAccount> {
    return toDto(await this.find(getOrg(req).orgId, slug));
  }

  @RequirePermission("provider_account:write")
  @Post()
  @HttpCode(201)
  async create(@Req() req: Request, @Body() body: unknown): Promise<ProviderAccount> {
    const input = await this.validate(req, ProviderAccountCreateSchema, body);
    const org = getOrg(req);
    const actor = getAuth(req);
    let row: Row;
    try {
      const r = await this.pool.query<Row>(
        `INSERT INTO provider_accounts (org_id, slug, name, provider, secret_ref, description, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
        [org.orgId, input.slug, input.name, input.provider, input.secretRef, input.description ?? null, actor.userId],
      );
      row = r.rows[0]!;
    } catch (err) {
      rethrowConflict(err, "provider_account_slug_taken");
    }
    await this.audit(req, "provider_account.created", row, { provider: row.provider });
    return toDto(row);
  }

  @RequirePermission("provider_account:write")
  @Patch(":slug")
  async update(@Req() req: Request, @Param("slug") slug: string, @Body() body: unknown): Promise<ProviderAccount> {
    const input = await this.validate(req, ProviderAccountUpdateSchema, body);
    const org = getOrg(req);
    const current = await this.find(org.orgId, slug);
    if (current.archived_at) throw new ConflictException({ statusCode: 409, message: "provider_account_archived" });
    const r = await this.pool.query<Row>(
      `UPDATE provider_accounts
          SET name = COALESCE($3, name),
              secret_ref = COALESCE($4, secret_ref),
              description = CASE WHEN $5::boolean THEN $6 ELSE description END,
              updated_at = now()
        WHERE org_id = $1 AND id = $2 AND archived_at IS NULL
        RETURNING ${COLUMNS}`,
      [org.orgId, current.id, input.name ?? null, input.secretRef ?? null, input.description !== undefined, input.description ?? null],
    );
    const row = r.rows[0];
    if (!row) throw new ConflictException({ statusCode: 409, message: "provider_account_archived" });
    // Field names only; a reference change is recorded as "secretRef", not its value.
    await this.audit(req, "provider_account.updated", row, { fields: Object.keys(input).sort().join(",") });
    return toDto(row);
  }

  @RequirePermission("provider_account:license")
  @Post(":slug/license")
  @HttpCode(200)
  async changeLicense(@Req() req: Request, @Param("slug") slug: string, @Body() body: unknown): Promise<ProviderAccount> {
    const input = parseOr422(ProviderAccountLicenseChangeSchema, body);
    const org = getOrg(req);
    const actor = getAuth(req);
    const current = await this.find(org.orgId, slug);
    if (current.archived_at) throw new ConflictException({ statusCode: 409, message: "provider_account_archived" });
    if (current.license_status === input.licenseStatus) {
      return toDto(current);
    }
    const client = await this.pool.connect();
    let updatedRow: Row;
    try {
      await client.query("BEGIN");
      const r = await client.query<Row>(
        `UPDATE provider_accounts
            SET license_status = $3,
                license_status_changed_at = now(),
                license_status_changed_by_user_id = $4,
                updated_at = now()
          WHERE org_id = $1 AND id = $2 AND archived_at IS NULL
          RETURNING ${COLUMNS}`,
        [org.orgId, current.id, input.licenseStatus, actor.userId],
      );
      const row = r.rows[0];
      if (!row) throw new ConflictException({ statusCode: 409, message: "provider_account_archived" });
      updatedRow = row;
      await writeAudit(client as unknown as Pool, {
        action: "provider_account.license_status_changed",
        orgId: org.orgId,
        actorUserId: actor.userId,
        actorGithubUserId: actor.githubUserId,
        targetType: "provider_account",
        targetId: row.id,
        metadata: { from: current.license_status, to: input.licenseStatus },
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return toDto(updatedRow);
  }

  @RequirePermission("provider_account:write")
  @Post(":slug/archive")
  @HttpCode(200)
  async archive(@Req() req: Request, @Param("slug") slug: string): Promise<ProviderAccount> {
    const org = getOrg(req);
    const current = await this.find(org.orgId, slug);
    const r = await this.pool.query<Row>(
      `UPDATE provider_accounts SET archived_at = now(), updated_at = now()
        WHERE org_id = $1 AND id = $2 AND archived_at IS NULL RETURNING ${COLUMNS}`,
      [org.orgId, current.id],
    );
    const row = r.rows[0];
    if (!row) throw new ConflictException({ statusCode: 409, message: "provider_account_already_archived" });
    await this.audit(req, "provider_account.archived", row, {});
    return toDto(row);
  }

  /** Validate; if a credential was pasted into a secret_ref field, record that (without the value) before 422. */
  private async validate<S extends z.ZodType>(req: Request, schema: S, body: unknown): Promise<z.output<S>> {
    const r = schema.safeParse(body);
    if (!r.success) {
      const secretLike = r.error.issues.some((i) => (i as { params?: { problem?: string } }).params?.problem === "secret_like");
      if (secretLike) {
        const actor = getAuth(req);
        await writeAudit(this.pool, {
          action: "security.secret_like_rejected",
          orgId: getOrg(req).orgId,
          actorUserId: actor.userId,
          actorGithubUserId: actor.githubUserId,
          targetType: "provider_account",
          metadata: { field: "secretRef" },
        });
      }
    }
    return parseOr422(schema, body);
  }

  private async audit(req: Request, action: string, row: Row, extra: Record<string, string>): Promise<void> {
    const actor = getAuth(req);
    await writeAudit(this.pool, {
      action,
      orgId: getOrg(req).orgId,
      actorUserId: actor.userId,
      actorGithubUserId: actor.githubUserId,
      targetType: "provider_account",
      targetId: row.id,
      metadata: { slug: row.slug, ...extra },
    });
  }

  private async find(orgId: string, slug: string): Promise<Row> {
    if (!SlugSchema.safeParse(slug).success) throw new NotFoundException();
    const r = await this.pool.query<Row>(`SELECT ${COLUMNS} FROM provider_accounts WHERE org_id = $1 AND slug = $2`, [orgId, slug]);
    if (!r.rows[0]) throw new NotFoundException();
    return r.rows[0];
  }
}
