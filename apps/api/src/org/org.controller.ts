import { Controller, Get, Inject, NotFoundException, Req } from "@nestjs/common";
import type { Pool } from "@aidevteam/db";
import type { Request } from "express";
import { getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { DB_POOL } from "../tokens";

@Controller("org")
export class OrgController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /** The org of the current session. There is deliberately no /org/:id — scope never comes from the URL. */
  @RequirePermission("org:read")
  @Get()
  async current(@Req() req: Request): Promise<{ slug: string; name: string }> {
    const r = await this.pool.query<{ slug: string; name: string }>("SELECT slug, name FROM orgs WHERE id = $1 AND archived_at IS NULL", [getOrg(req).orgId]);
    if (!r.rows[0]) throw new NotFoundException();
    return r.rows[0];
  }
}
