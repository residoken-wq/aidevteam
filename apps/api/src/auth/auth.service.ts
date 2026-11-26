import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "@aidevteam/db";
import { writeAudit } from "../audit";
import type { AppConfig } from "../config";
import { pkceChallenge, randomToken, sha256 } from "../crypto";
import { APP_CONFIG, DB_POOL, GITHUB_CLIENT } from "../tokens";
import { buildAuthorizeUrl, GithubOAuthError, type GithubOAuthClient } from "./github-client";

/** GitHub authorization codes expire after 10 minutes; our login attempt must not outlive that. */
export const LOGIN_STATE_TTL_MS = 10 * 60 * 1000;

export type LoginFailure = "state" | "denied" | "failed";

export interface SessionUser {
  sessionId: string;
  userId: string;
  githubUserId: number;
  githubLogin: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(GITHUB_CLIENT) private readonly github: GithubOAuthClient,
  ) {}

  /** Start a login attempt: persist hash(state) + PKCE verifier, return the GitHub authorize URL and raw state for the cookie. */
  async startLogin(): Promise<{ authorizeUrl: string; state: string }> {
    const state = randomToken();
    const verifier = randomToken();
    await this.pool.query(
      "INSERT INTO oauth_login_states (state_hash, code_verifier, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))",
      [sha256(state), verifier, LOGIN_STATE_TTL_MS / 1000],
    );
    const authorizeUrl = buildAuthorizeUrl({
      clientId: this.config.github.clientId,
      redirectUri: this.config.github.callbackUrl,
      state,
      codeChallenge: pkceChallenge(verifier),
    });
    return { authorizeUrl, state };
  }

  /**
   * Complete the callback. The caller has already checked that the query `state` equals the state cookie.
   * Returns a new raw session token on success. The state row is consumed atomically (single use).
   */
  async completeLogin(input: { state: string; code: string; requestId: string }): Promise<{ ok: true; sessionToken: string } | { ok: false; reason: LoginFailure }> {
    const consumed = await this.pool.query<{ code_verifier: string }>(
      `UPDATE oauth_login_states SET used_at = now()
        WHERE state_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING code_verifier`,
      [sha256(input.state)],
    );
    const row = consumed.rows[0];
    if (!row) {
      await writeAudit(this.pool, { action: "auth.state_mismatch", requestId: input.requestId, metadata: { reason: "unknown_used_or_expired" } });
      return { ok: false, reason: "state" };
    }

    let identity;
    try {
      identity = await this.github.exchangeCodeForIdentity({ code: input.code, codeVerifier: row.code_verifier, redirectUri: this.config.github.callbackUrl });
    } catch (err) {
      const reason = err instanceof GithubOAuthError ? err.reason : "exchange_failed";
      await writeAudit(this.pool, { action: "auth.login_failed", requestId: input.requestId, metadata: { reason } });
      return { ok: false, reason: "failed" };
    }

    const allowed = await this.pool.query("SELECT 1 FROM user_allowlist WHERE github_user_id = $1", [identity.id]);
    if (allowed.rowCount === 0) {
      await writeAudit(this.pool, {
        action: "auth.login_denied",
        actorGithubUserId: identity.id,
        requestId: input.requestId,
        metadata: { reason: "not_allowlisted" },
      });
      return { ok: false, reason: "denied" };
    }

    const user = await this.pool.query<{ id: string; disabled_at: Date | null }>(
      `INSERT INTO users (github_user_id, github_login) VALUES ($1, $2)
       ON CONFLICT (github_user_id) DO UPDATE SET github_login = EXCLUDED.github_login
       RETURNING id, disabled_at`,
      [identity.id, identity.login],
    );
    const u = user.rows[0]!;
    if (u.disabled_at) {
      await writeAudit(this.pool, { action: "auth.login_denied", actorUserId: u.id, actorGithubUserId: identity.id, requestId: input.requestId, metadata: { reason: "user_disabled" } });
      return { ok: false, reason: "denied" };
    }

    const sessionToken = randomToken();
    const session = await this.pool.query<{ id: string }>(
      "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3)) RETURNING id",
      [u.id, sha256(sessionToken), this.config.sessionTtlMinutes],
    );
    await writeAudit(this.pool, {
      action: "auth.login_succeeded",
      actorUserId: u.id,
      actorGithubUserId: identity.id,
      targetType: "session",
      targetId: session.rows[0]!.id,
      requestId: input.requestId,
    });
    return { ok: true, sessionToken };
  }

  async recordStateMismatch(requestId: string, reason: string): Promise<void> {
    await writeAudit(this.pool, { action: "auth.state_mismatch", requestId, metadata: { reason } });
  }

  /** Resolve a raw session token to an active session (not revoked, not expired, user not disabled). */
  async getSession(sessionToken: string | undefined): Promise<SessionUser | null> {
    if (!sessionToken || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) return null;
    const r = await this.pool.query<{ session_id: string; user_id: string; github_user_id: string; github_login: string | null }>(
      `SELECT s.id AS session_id, u.id AS user_id, u.github_user_id, u.github_login
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.disabled_at IS NULL`,
      [sha256(sessionToken)],
    );
    const row = r.rows[0];
    if (!row) return null;
    return { sessionId: row.session_id, userId: row.user_id, githubUserId: Number(row.github_user_id), githubLogin: row.github_login };
  }

  /** Revoke a session server-side. Returns false when the token did not map to an active session. */
  async logout(sessionToken: string | undefined, requestId: string): Promise<boolean> {
    const s = await this.getSession(sessionToken);
    if (!s) return false;
    await this.pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [s.sessionId]);
    await writeAudit(this.pool, { action: "auth.logout", actorUserId: s.userId, actorGithubUserId: s.githubUserId, targetType: "session", targetId: s.sessionId, requestId });
    return true;
  }

  /** Revoke any session presented when a new login completes (prevents session fixation/reuse). */
  async revokeIfPresent(sessionToken: string | undefined): Promise<void> {
    if (!sessionToken) return;
    await this.pool.query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [sha256(sessionToken)]);
  }
}
