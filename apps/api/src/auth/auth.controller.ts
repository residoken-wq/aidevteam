import { Controller, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { AppConfig } from "../config";
import { clearSecureCookie, OAUTH_STATE_COOKIE, parseCookies, SESSION_COOKIE, setSecureCookie } from "../cookies";
import { safeEqual } from "../crypto";
import { APP_CONFIG } from "../tokens";
import { AuthService, LOGIN_STATE_TTL_MS } from "./auth.service";

const PARAM_RE = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * Routes are served by the API and reached by browsers through the web app (Next.js rewrites /auth/*),
 * so every redirect target below is a fixed same-origin path — there is no user-controlled redirect.
 */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get("github/login")
  async login(@Res() res: Response): Promise<void> {
    const { authorizeUrl, state } = await this.auth.startLogin();
    setSecureCookie(res, OAUTH_STATE_COOKIE, state, LOGIN_STATE_TTL_MS);
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, authorizeUrl);
  }

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

  @Get("me")
  async me(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ githubUserId: number; githubLogin: string | null }> {
    res.setHeader("Cache-Control", "no-store");
    const s = await this.auth.getSession(parseCookies(req.headers.cookie).get(SESSION_COOKIE));
    if (!s) throw new UnauthorizedException();
    return { githubUserId: s.githubUserId, githubLogin: s.githubLogin };
  }

  /** POST only + Origin check (CSRF). SameSite=Lax alone is not relied upon. */
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
