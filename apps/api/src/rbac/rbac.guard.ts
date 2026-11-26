import { ForbiddenException, Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Pool } from "@aidevteam/db";
import type { Request } from "express";
import { writeAudit } from "../audit";
import { AuthService } from "../auth/auth.service";
import type { AppConfig } from "../config";
import { parseCookies, SESSION_COOKIE } from "../cookies";
import { APP_CONFIG, DB_POOL } from "../tokens";
import { setAuth } from "./auth-context";
import { ACCESS_KEY, type AccessRule } from "./decorators";
import { RbacService } from "./rbac.service";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Global guard — default deny:
 *  - route without @Public/@Authenticated/@RequirePermission → 403 (even for admins);
 *  - no valid session → 401;
 *  - state-changing methods require Origin === PUBLIC_BASE_URL (CSRF);
 *  - permission routes need an active org whose roles grant the permission → else 403 + audit rbac.denied;
 *  - platform routes need an operator-granted platform admin (P2-03) → else 403 + audit rbac.denied.
 */
@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly rbac: RbacService,
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, [context.getHandler(), context.getClass()]);
    if (rule?.kind === "public") return true;

    const req = context.switchToHttp().getRequest<Request>();
    const session = await this.auth.getSession(parseCookies(req.headers.cookie).get(SESSION_COOKIE));
    if (!session) throw new UnauthorizedException();

    if (!SAFE_METHODS.has(req.method) && req.headers.origin !== this.config.publicBaseUrl) {
      await this.deny(session.userId, session.githubUserId, null, "csrf_origin_mismatch", req);
      throw new ForbiddenException();
    }

    const [memberships, platformAdmin] = await Promise.all([this.rbac.memberships(session.userId), this.rbac.isPlatformAdmin(session.userId)]);
    const org = this.rbac.resolveOrg(memberships, session.activeOrgId);
    setAuth(req, { ...session, memberships, org, platformAdmin });

    if (!rule) {
      await this.deny(session.userId, session.githubUserId, org?.orgId ?? null, "no_access_rule", req);
      throw new ForbiddenException();
    }
    if (rule.kind === "authenticated") return true;

    // Platform routes never use the org context, and org routes never accept platform admin status.
    if (rule.kind === "platform") {
      if (!platformAdmin) {
        await this.deny(session.userId, session.githubUserId, null, "not_platform_admin", req, rule.permission);
        throw new ForbiddenException();
      }
      return true;
    }

    if (!org) {
      await this.deny(session.userId, session.githubUserId, null, memberships.length ? "org_not_selected" : "no_role", req);
      throw new ForbiddenException(memberships.length ? "org_selection_required" : "no_role");
    }
    if (!org.permissions.has(rule.permission)) {
      await this.deny(session.userId, session.githubUserId, org.orgId, "missing_permission", req, rule.permission);
      throw new ForbiddenException();
    }
    return true;
  }

  private async deny(userId: string, githubUserId: number, orgId: string | null, reason: string, req: Request, permission?: string): Promise<void> {
    await writeAudit(this.pool, {
      action: "rbac.denied",
      orgId,
      actorUserId: userId,
      actorGithubUserId: githubUserId,
      targetType: "route",
      // Route pattern only (no ids/query strings), e.g. GET /audit/events/:id
      targetId: `${req.method} ${(req.route as { path?: string } | undefined)?.path ?? "unknown"}`.slice(0, 128),
      metadata: { reason, ...(permission ? { permission } : {}) },
    });
  }
}
