import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  MemberRoleChangeSchema,
  type Member,
  type MemberRoleChange,
  type MemberRoleChangeResult,
  type RoleKey,
} from "@aidevteam/contracts";
import type { Pool, PoolClient } from "@aidevteam/db";
import type { Request } from "express";
import { getAuth, getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { DB_POOL } from "../tokens";

interface MemberRow {
  github_user_id: string | number;
  github_login: string | null;
  roles: RoleKey[];
}

function parseRoleChange(body: unknown): MemberRoleChange {
  const r = MemberRoleChangeSchema.safeParse(body);
  if (r.success) return r.data;
  if (r.error.issues.some((i) => i.code === "unrecognized_keys")) {
    throw new BadRequestException({ statusCode: 400, message: "unrecognized_keys" });
  }
  throw new UnprocessableEntityException({
    statusCode: 422,
    message: "validation_failed",
    issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

/**
 * Org member and role management (P2-04).
 * Scoped strictly to the session's active org; never accepts org from URL/body/query.
 * Writes run under an org-level advisory transaction lock to guarantee safety.
 */
@Controller("org/members")
export class MembersController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("member:read")
  @Get()
  async list(@Req() req: Request): Promise<Member[]> {
    const org = getOrg(req);
    const r = await this.pool.query<MemberRow>(
      `SELECT u.github_user_id, u.github_login, array_agg(r.key ORDER BY r.key) AS roles
         FROM role_bindings rb
         JOIN roles r ON r.id = rb.role_id AND r.org_id = rb.org_id
         JOIN users u ON u.id = rb.user_id
        WHERE rb.org_id = $1
        GROUP BY u.github_user_id, u.github_login
        ORDER BY u.github_user_id ASC`,
      [org.orgId],
    );
    return r.rows.map((row) => ({
      githubUserId: Number(row.github_user_id),
      githubLogin: row.github_login,
      roles: row.roles,
    }));
  }

  @RequirePermission("member:write")
  @Post("roles")
  @HttpCode(200)
  async grantRole(@Req() req: Request, @Body() body: unknown): Promise<MemberRoleChangeResult> {
    const input = parseRoleChange(body);
    const actor = getAuth(req);
    const org = getOrg(req);

    if (input.githubUserId === actor.githubUserId) {
      throw new ConflictException({ statusCode: 409, message: "cannot_change_own_roles" });
    }

    return this.locked(org.orgId, async (c) => {
      const roleRow = await c.query<{ id: string }>(
        "SELECT id FROM roles WHERE org_id = $1 AND key = $2",
        [org.orgId, input.role],
      );
      if (!roleRow.rows[0]) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          message: "role_not_found",
          issues: [{ path: "role", message: "role_not_found" }],
        });
      }
      const roleId = roleRow.rows[0].id;

      const allowlist = await c.query("SELECT 1 FROM user_allowlist WHERE github_user_id = $1", [input.githubUserId]);
      if (allowlist.rowCount === 0) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          message: "user_not_allowlisted",
          issues: [{ path: "githubUserId", message: "user_not_allowlisted" }],
        });
      }

      const existingUser = await c.query<{ id: string; disabled_at: Date | null }>(
        "SELECT id, disabled_at FROM users WHERE github_user_id = $1",
        [input.githubUserId],
      );
      let targetUserId: string;
      if (existingUser.rows[0]) {
        if (existingUser.rows[0].disabled_at !== null) {
          throw new UnprocessableEntityException({
            statusCode: 422,
            message: "user_disabled",
            issues: [{ path: "githubUserId", message: "user_disabled" }],
          });
        }
        targetUserId = existingUser.rows[0].id;
      } else {
        const inserted = await c.query<{ id: string; disabled_at: Date | null }>(
          `INSERT INTO users (github_user_id) VALUES ($1)
           ON CONFLICT (github_user_id) DO UPDATE SET github_user_id = EXCLUDED.github_user_id
           RETURNING id, disabled_at`,
          [input.githubUserId],
        );
        if (inserted.rows[0]?.disabled_at !== null) {
          throw new UnprocessableEntityException({
            statusCode: 422,
            message: "user_disabled",
            issues: [{ path: "githubUserId", message: "user_disabled" }],
          });
        }
        targetUserId = inserted.rows[0].id;
      }

      const bind = await c.query(
        "INSERT INTO role_bindings (org_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [org.orgId, targetUserId, roleId],
      );
      const changed = bind.rowCount === 1;
      if (changed) {
        await c.query(
          `INSERT INTO audit_events (org_id, actor_user_id, actor_github_user_id, action, target_type, target_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            org.orgId,
            actor.userId,
            actor.githubUserId,
            "org.role_granted",
            "github_user",
            String(input.githubUserId),
            JSON.stringify({ role: input.role }),
          ],
        );
      }
      return { changed };
    });
  }

  @RequirePermission("member:write")
  @Delete("roles")
  @HttpCode(200)
  async revokeRole(@Req() req: Request, @Body() body: unknown): Promise<MemberRoleChangeResult> {
    const input = parseRoleChange(body);
    const actor = getAuth(req);
    const org = getOrg(req);

    if (input.githubUserId === actor.githubUserId) {
      throw new ConflictException({ statusCode: 409, message: "cannot_change_own_roles" });
    }

    return this.locked(org.orgId, async (c) => {
      const roleRow = await c.query<{ id: string }>(
        "SELECT id FROM roles WHERE org_id = $1 AND key = $2",
        [org.orgId, input.role],
      );
      if (!roleRow.rows[0]) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          message: "role_not_found",
          issues: [{ path: "role", message: "role_not_found" }],
        });
      }
      const roleId = roleRow.rows[0].id;

      const userRow = await c.query<{ id: string }>(
        "SELECT id FROM users WHERE github_user_id = $1",
        [input.githubUserId],
      );
      if (!userRow.rows[0]) {
        return { changed: false };
      }
      const targetUserId = userRow.rows[0].id;

      const existingBinding = await c.query(
        "SELECT 1 FROM role_bindings WHERE org_id = $1 AND user_id = $2 AND role_id = $3",
        [org.orgId, targetUserId, roleId],
      );
      if (existingBinding.rowCount === 0) {
        return { changed: false };
      }

      if (input.role === "org_admin") {
        const countRes = await c.query<{ count: string }>(
          `SELECT count(rb.id) AS count
             FROM role_bindings rb
             JOIN roles r ON r.id = rb.role_id AND r.org_id = rb.org_id
            WHERE rb.org_id = $1 AND r.key = 'org_admin'`,
          [org.orgId],
        );
        const count = Number(countRes.rows[0]?.count ?? 0);
        if (count <= 1) {
          throw new ConflictException({ statusCode: 409, message: "last_org_admin" });
        }
      }

      const del = await c.query(
        "DELETE FROM role_bindings WHERE org_id = $1 AND user_id = $2 AND role_id = $3",
        [org.orgId, targetUserId, roleId],
      );
      const changed = del.rowCount === 1;
      if (changed) {
        await c.query(
          `INSERT INTO audit_events (org_id, actor_user_id, actor_github_user_id, action, target_type, target_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            org.orgId,
            actor.userId,
            actor.githubUserId,
            "org.role_revoked",
            "github_user",
            String(input.githubUserId),
            JSON.stringify({ role: input.role }),
          ],
        );
      }
      return { changed };
    });
  }

  private async locked<T>(orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtext('org_members:' || $1::text))", [orgId]);
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
