import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { PLATFORM_PERMISSIONS } from "@aidevteam/contracts";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { AppConfig } from "../config";
import { clearSecureCookie, OAUTH_STATE_COOKIE, parseCookies, SESSION_COOKIE, setSecureCookie } from "../cookies";
import { safeEqual } from "../crypto";
import { writeAudit } from "../audit";
import { LOGIN_RATE_LIMIT, RateLimitService } from "../rate-limit";
import { getAuth } from "../rbac/auth-context";
import { Authenticated, Public } from "../rbac/decorators";
import { APP_CONFIG, DB_POOL } from "../tokens";
import type { Pool } from "@aidevteam/db";
import { AuthService, LOGIN_STATE_TTL_MS } from "./auth.service";

const PARAM_RE = /^[A-Za-z0-9_-]{1,256}$/;

export interface MeResponse {
  githubUserId: number;
  githubLogin: string | null;
  orgs: Array<{ slug: string; roles: string[] }>;
  activeOrg: { slug: string; roles: string[]; permissions: string[] } | null;
  /** Platform permissions (P2-03); empty unless an operator granted platform admin. */
  platformPermissions: string[];
}

/**
 * Routes are served by the API and reached by browsers through the web app (Next.js rewrites /auth/*),
 * so every redirect target below is a fixed same-origin path — there is no user-controlled redirect.
 */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB_POOL) private readonly pool: Pool,
  ) {}

  @Public()
  @Get("github/login")
  async login(@Req() req: Request, @Res() res: Response): Promise<void> {
    // req.ip honours TRUSTED_PROXY_IPS ("trust proxy"); untrusted X-Forwarded-For is ignored.
    const limit = await this.rateLimit.hit(LOGIN_RATE_LIMIT, req.ip ?? "unknown");
    if (!limit.allowed) {
      await writeAudit(this.pool, { action: "auth.rate_limited", requestId: randomUUID(), metadata: { scope: LOGIN_RATE_LIMIT.scope } });
      res.setHeader("Retry-After", String(limit.retryAfterSeconds));
      res.status(429).type("text/plain; charset=utf-8").send("Quá nhiều lần đăng nhập. Vui lòng thử lại sau.");
      return;
    }
    const { authorizeUrl, state } = await this.auth.startLogin();
    setSecureCookie(res, OAUTH_STATE_COOKIE, state, LOGIN_STATE_TTL_MS);
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, authorizeUrl);
  }

  @Public()
  @Get("github/callback")
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const requestId = randomUUID();
    const cookies = parseCookies(req.headers.cookie);
    const cookieState = cookies.get(OAUTH_STATE_COOKIE);
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    res.setHeader("Cache-Control", "no-store");
    clearSecureCookie(res, OAUTH_STATE_COOKIE);

    if (typeof req.query.error === "string") {
      // User cancelled on GitHub (e.g. access_denied). Nothing was issued.
      return this.fail(res, "failed");
    }
    if (!state || !cookieState || !PARAM_RE.test(state) || !safeEqual(state, cookieState)) {
      await this.auth.recordStateMismatch(requestId, !cookieState ? "missing_cookie" : "mismatch");
      return this.fail(res, "state");
    }
    if (!code || !PARAM_RE.test(code)) return this.fail(res, "failed");

    const result = await this.auth.completeLogin({ state, code, requestId });
    if (!result.ok) return this.fail(res, result.reason);

    await this.auth.revokeIfPresent(cookies.get(SESSION_COOKIE));
    setSecureCookie(res, SESSION_COOKIE, result.sessionToken, this.config.sessionTtlMinutes * 60 * 1000);
    res.redirect(303, "/");
  }

  @Authenticated()
  @Get("me")
  me(@Req() req: Request, @Res({ passthrough: true }) res: Response): MeResponse {
    res.setHeader("Cache-Control", "no-store");
    const a = getAuth(req);
    return {
      githubUserId: a.githubUserId,
      githubLogin: a.githubLogin,
      orgs: a.memberships.map((m) => ({ slug: m.orgSlug, roles: m.roles })),
      activeOrg: a.org ? { slug: a.org.orgSlug, roles: a.org.roles, permissions: [...a.org.permissions].sort() } : null,
      platformPermissions: a.platformAdmin ? [...PLATFORM_PERMISSIONS] : [],
    };
  }

  /** Choose the org to work in. Membership is verified server-side; the org id never comes from the client. */
  @Authenticated()
  @Post("active-org")
  @HttpCode(303)
  async setActiveOrg(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const slug = typeof body === "object" && body !== null ? (body as { orgSlug?: unknown }).orgSlug : undefined;
    const a = getAuth(req);
    const membership = typeof slug === "string" ? a.memberships.find((m) => m.orgSlug === slug) : undefined;
    if (!membership) {
      await writeAudit(this.pool, { action: "rbac.denied", actorUserId: a.userId, actorGithubUserId: a.githubUserId, targetType: "route", targetId: "POST /auth/active-org", metadata: { reason: "not_a_member" } });
      throw new ForbiddenException();
    }
    await this.auth.setActiveOrg(a, membership.orgId, randomUUID());
    // Works for both the browser form on the home page and API clients.
    res.redirect(303, "/");
  }

  /** POST only + Origin check (CSRF). SameSite=Lax alone is not relied upon. Public so an expired session can still clear its cookie. */
  @Public()
  @Post("logout")
  @HttpCode(303)
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (req.headers.origin !== this.config.publicBaseUrl) throw new ForbiddenException();
    await this.auth.logout(parseCookies(req.headers.cookie).get(SESSION_COOKIE), randomUUID());
    clearSecureCookie(res, SESSION_COOKIE);
    res.redirect(303, "/login");
  }

  private fail(res: Response, reason: "state" | "denied" | "failed"): void {
    res.redirect(303, `/login?error=${reason}`);
  }
}
