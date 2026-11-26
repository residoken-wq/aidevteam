import { Controller, Get, Inject, NotFoundException, Param, Query, Req } from "@nestjs/common";
import type { Pool } from "@aidevteam/db";
import type { Request } from "express";
import { getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { DB_POOL } from "../tokens";

interface AuditRow {
  id: string;
  action: string;
  actor_github_user_id: string | null;
  target_type: string | null;
  target_id: string | null;
  occurred_at: Date;
}

const toDto = (r: AuditRow) => ({
  id: Number(r.id),
  action: r.action,
  actorGithubUserId: r.actor_github_user_id === null ? null : Number(r.actor_github_user_id),
  targetType: r.target_type,
  targetId: r.target_id,
  occurredAt: r.occurred_at.toISOString(),
});

/** Read-only audit log of the session's org (org_admin only). Metadata is not exposed. */
@Controller("audit")
export class AuditController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("audit:read")
  @Get("events")
  async list(@Req() req: Request, @Query("limit") limitRaw?: string) {
    const limit = /^\d{1,3}$/.test(limitRaw ?? "") ? Math.min(Math.max(Number(limitRaw), 1), 200) : 50;
    const r = await this.pool.query<AuditRow>(
      `SELECT id, action, actor_github_user_id, target_type, target_id, occurred_at
         FROM audit_events WHERE org_id = $1 ORDER BY id DESC LIMIT $2`,
      [getOrg(req).orgId, limit],
    );
    return r.rows.map(toDto);
  }

  @RequirePermission("audit:read")
  @Get("events/:id")
  async one(@Req() req: Request, @Param("id") idRaw: string) {
    if (!/^\d{1,18}$/.test(idRaw)) throw new NotFoundException();
    const r = await this.pool.query<AuditRow>(
      `SELECT id, action, actor_github_user_id, target_type, target_id, occurred_at
         FROM audit_events WHERE id = $1 AND org_id = $2`,
      [idRaw, getOrg(req).orgId],
    );
    // Another org's event and a missing event look the same (no existence leak).
    if (!r.rows[0]) throw new NotFoundException();
    return toDto(r.rows[0]);
  }
}
