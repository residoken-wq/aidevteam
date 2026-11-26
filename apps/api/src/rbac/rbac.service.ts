import { Inject, Injectable } from "@nestjs/common";
import { permissionsFor, type Permission } from "@aidevteam/contracts";
import type { Pool } from "@aidevteam/db";
import { DB_POOL } from "../tokens";

export interface OrgMembership {
  orgId: string;
  orgSlug: string;
  roles: string[];
}

export interface OrgContext {
  orgId: string;
  orgSlug: string;
  roles: string[];
  permissions: Set<Permission>;
}

@Injectable()
export class RbacService {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /** All non-archived orgs where the user holds at least one role, re-read on every request. */
  async memberships(userId: string): Promise<OrgMembership[]> {
    const r = await this.pool.query<{ org_id: string; slug: string; roles: string[] }>(
      `SELECT o.id AS org_id, o.slug, array_agg(r.key ORDER BY r.key) AS roles
         FROM role_bindings rb
         JOIN roles r ON r.id = rb.role_id AND r.org_id = rb.org_id
         JOIN orgs o ON o.id = rb.org_id AND o.archived_at IS NULL
        WHERE rb.user_id = $1
        GROUP BY o.id, o.slug
        ORDER BY o.slug`,
      [userId],
    );
    return r.rows.map((x) => ({ orgId: x.org_id, orgSlug: x.slug, roles: x.roles }));
  }

  /** Platform admin flag, re-read on every request so a CLI revoke takes effect immediately. */
  async isPlatformAdmin(userId: string): Promise<boolean> {
    const r = await this.pool.query("SELECT 1 FROM platform_admins WHERE user_id = $1", [userId]);
    return r.rowCount === 1;
  }

  /**
   * Tenant scope comes only from the session: the session's active org if the user is still a member,
   * otherwise the single org they belong to. Several orgs and none selected → null (must choose).
   */
  resolveOrg(memberships: OrgMembership[], activeOrgId: string | null): OrgContext | null {
    // A stale active org (membership revoked) falls back to the single-org rule; it never grants access by itself.
    const active = activeOrgId ? memberships.find((m) => m.orgId === activeOrgId) : undefined;
    const chosen = active ?? (memberships.length === 1 ? memberships[0] : undefined);
    if (!chosen) return null;
    return { orgId: chosen.orgId, orgSlug: chosen.orgSlug, roles: chosen.roles, permissions: permissionsFor(chosen.roles) };
  }
}
