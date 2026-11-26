import type { INestApplication } from "@nestjs/common";
import { createPool, migrateUp, seed, type Pool } from "@aidevteam/db";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GithubOAuthError, type GithubIdentity, type GithubOAuthClient } from "../../src/auth/github-client";
import { createApp } from "../../src/bootstrap";
import { OAUTH_STATE_COOKIE, SESSION_COOKIE } from "../../src/cookies";
import { pkceChallenge } from "../../src/crypto";
import { testConfig } from "../helpers";

/**
 * P1-05G integration tests (CLAUDE.md §5.3). GitHub is replaced by a fake client — no network,
 * no real credentials. Seeded allowlist: 900000001, 900000002 (fake). 900000099 is NOT allowlisted.
 */
const FAKE_ACCESS_TOKEN = "gho_FAKEFAKEFAKEFAKEFAKEFAKE1111111111";
const ORIGIN = "https://cc.example.com";

class FakeGithub implements GithubOAuthClient {
  identities = new Map<string, GithubIdentity>();
  calls: Array<{ code: string; codeVerifier: string; redirectUri: string }> = [];
  async exchangeCodeForIdentity(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<GithubIdentity> {
    this.calls.push(input);
    // Simulate GitHub holding an access token we must never persist.
    void FAKE_ACCESS_TOKEN;
    const id = this.identities.get(input.code);
    if (!id) throw new GithubOAuthError("exchange_failed");
    return id;
  }
}

function testDbPool(): Pool {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required (database name must end with _test)");
  if (!/_test$/.test(new URL(url).pathname.slice(1))) throw new Error("refusing to run: database name must end with _test");
  return createPool(url, { max: 5 });
}

let pool: Pool;
let app: INestApplication;
const github = new FakeGithub();

beforeAll(async () => {
  pool = testDbPool();
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrateUp(pool);
  await seed(pool, { NODE_ENV: "test" });
  github.identities.set("code-allowed", { id: 900000001, login: "test-user-01" });
  github.identities.set("code-allowed-2", { id: 900000001, login: "test-user-01" });
  github.identities.set("code-not-allowed", { id: 900000099, login: "test-outsider" });
  app = await createApp({ config: testConfig(), pool, githubClient: github });
  await app.init();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(() => {
  github.calls = [];
});

function cookieFrom(res: request.Response, name: string): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const line = raw?.find((c) => c.startsWith(`${name}=`));
  return line?.split(";")[0]!.slice(name.length + 1);
}

function setCookieLine(res: request.Response, name: string): string {
  const raw = (res.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
  return raw.find((c) => c.startsWith(`${name}=`)) ?? "";
}

async function startLogin(): Promise<{ state: string; location: URL }> {
  const res = await request(app.getHttpServer()).get("/auth/github/login").expect(302);
  const location = new URL(res.headers.location as string);
  const state = cookieFrom(res, OAUTH_STATE_COOKIE)!;
  return { state, location };
}

async function countAudit(action: string): Promise<number> {
  const r = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_events WHERE action = $1", [action]);
  return r.rows[0]!.n;
}

async function countSessions(): Promise<number> {
  return (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM sessions")).rows[0]!.n;
}

async function loginAs(code: string): Promise<string> {
  const { state } = await startLogin();
  const res = await request(app.getHttpServer())
    .get(`/auth/github/callback?code=${code}&state=${state}`)
    .set("Cookie", `${OAUTH_STATE_COOKIE}=${state}`)
    .expect(303);
  expect(res.headers.location).toBe("/");
  return cookieFrom(res, SESSION_COOKIE)!;
}

describe("GET /auth/github/login", () => {
  it("redirects to GitHub with state + PKCE S256, no scope, and sets a hardened state cookie", async () => {
    const res = await request(app.getHttpServer()).get("/auth/github/login").expect(302);
    const loc = new URL(res.headers.location as string);
    expect(loc.origin + loc.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(loc.searchParams.get("client_id")).toBe("Iv1.testclientid");
    expect(loc.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/github/callback`);
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.has("scope")).toBe(false);
    const cookie = setCookieLine(res, OAUTH_STATE_COOKIE);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(loc.searchParams.get("state")).toBe(cookieFrom(res, OAUTH_STATE_COOKIE));
  });

  it("stores only a hash of state in the database", async () => {
    const { state } = await startLogin();
    const r = await pool.query("SELECT 1 FROM oauth_login_states WHERE encode(state_hash, 'escape') LIKE $1", [`%${state}%`]);
    expect(r.rowCount).toBe(0);
  });
});

describe("GET /auth/github/callback — rejections (§5.3)", () => {
  it("rejects a state that does not match the cookie: no session, audited", async () => {
    const before = { sessions: await countSessions(), audit: await countAudit("auth.state_mismatch") };
    const { state } = await startLogin();
    const res = await request(app.getHttpServer())
      .get(`/auth/github/callback?code=code-allowed&state=${"x".repeat(43)}`)
      .set("Cookie", `${OAUTH_STATE_COOKIE}=${state}`)
      .expect(303);
    expect(res.headers.location).toBe("/login?error=state");
    expect(cookieFrom(res, SESSION_COOKIE) ?? "").toBe("");
    expect(await countSessions()).toBe(before.sessions);
    expect(await countAudit("auth.state_mismatch")).toBe(before.audit + 1);
    expect(github.calls).toHaveLength(0);
  });

  it("rejects an attacker's valid state that is not bound to this browser's cookie (login CSRF)", async () => {
    const attacker = await startLogin(); // attacker's own, valid, unused state
    const victim = await startLogin(); // victim's browser holds a different state cookie
    const res = await request(app.getHttpServer())
      .get(`/auth/github/callback?code=code-allowed&state=${attacker.state}`)
      .set("Cookie", `${OAUTH_STATE_COOKIE}=${victim.state}`)
      .expect(303);
    expect(res.headers.location).toBe("/login?error=state");
    expect(cookieFrom(res, SESSION_COOKIE) ?? "").toBe("");
    expect(github.calls).toHaveLength(0);
  });

  it("rejects a callback without the state cookie (login CSRF)", async () => {
    const { state } = await startLogin();
    const res = await request(app.getHttpServer()).get(`/auth/github/callback?code=code-allowed&state=${state}`).expect(303);
    expect(res.headers.location).toBe("/login?error=state");
    expect(github.calls).toHaveLength(0);
  });

  it("rejects a reused state (single use)", async () => {
    const { state } = await startLogin();
    const cb = () =>
      request(app.getHttpServer()).get(`/auth/github/callback?code=code-allowed&state=${state}`).set("Cookie", `${OAUTH_STATE_COOKIE}=${state}`);
    expect((await cb()).headers.location).toBe("/");
    expect((await cb()).headers.location).toBe("/login?error=state");
  });

  it("rejects an expired state", async () => {
    const { state } = await startLogin();
    await pool.query("UPDATE oauth_login_states SET created_at = now() - interval '20 minutes', expires_at = now() - interval '1 minute' WHERE used_at IS NULL");
    const res = await request(app.getHttpServer())
      .get(`/auth/github/callback?code=code-allowed&state=${state}`)
      .set("Cookie", `${OAUTH_STATE_COOKIE}=${state}`)
      .expect(303);
    expect(res.headers.location).toBe("/login?error=state");
  });

  it("rejects a valid GitHub user who is not in the allowlist: no user row, no session, audited", async () => {
    const before = { sessions: await countSessions(), audit: await countAudit("auth.login_denied") };
    const { state } = await startLogin();
    const res = await request(app.getHttpServer())
      .get(`/auth/github/callback?code=code-not-allowed&state=${state}`)
      .set("Cookie", `${OAUTH_STATE_COOKIE}=${state}`)
      .expect(303);
    expect(res.headers.location).toBe("/login?error=denied");
    expect(await countSessions()).toBe(before.sessions);
    expect(await countAudit("auth.login_denied")).toBe(before.audit + 1);
    expect((await pool.query("SELECT 1 FROM users WHERE github_user_id = 900000099")).rowCount).toBe(0);
    const audit = await pool.query("SELECT actor_github_user_id FROM audit_events WHERE action = 'auth.login_denied' ORDER BY id DESC LIMIT 1");
    expect(Number(audit.rows[0].actor_github_user_id)).toBe(900000099);
  });

  it("fails closed when GitHub rejects the code", async () => {
    const { state } = await startLogin();
    const res = await request(app.getHttpServer())
      .get(`/auth/github/callback?code=code-unknown&state=${state}`)
      .set("Cookie", `${OAUTH_STATE_COOKIE}=${state}`)
      .expect(303);
    expect(res.headers.location).toBe("/login?error=failed");
  });

  it("sends the PKCE verifier matching the challenge and the registered redirect_uri", async () => {
    const { state, location } = await startLogin();
    await request(app.getHttpServer()).get(`/auth/github/callback?code=code-allowed&state=${state}`).set("Cookie", `${OAUTH_STATE_COOKIE}=${state}`);
    const call = github.calls[0]!;
    expect(pkceChallenge(call.codeVerifier)).toBe(location.searchParams.get("code_challenge"));
    expect(call.redirectUri).toBe(`${ORIGIN}/auth/github/callback`);
  });
});

describe("sessions", () => {
  it("allowlisted login creates a hardened server-side session and grants no role", async () => {
    const res1 = await startLogin();
    const res = await request(app.getHttpServer())
      .get(`/auth/github/callback?code=code-allowed&state=${res1.state}`)
      .set("Cookie", `${OAUTH_STATE_COOKIE}=${res1.state}`)
      .expect(303);
    const line = setCookieLine(res, SESSION_COOKIE);
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Secure/i);
    expect(line).toMatch(/SameSite=Lax/i);
    const token = cookieFrom(res, SESSION_COOKIE)!;
    const me = await request(app.getHttpServer()).get("/auth/me").set("Cookie", `${SESSION_COOKIE}=${token}`).expect(200);
    expect(me.body).toEqual({ githubUserId: 900000001, githubLogin: "test-user-01" });
    expect((await pool.query("SELECT 1 FROM role_bindings")).rowCount).toBe(0);
    expect(await countAudit("auth.login_succeeded")).toBeGreaterThan(0);
  });

  it("never persists the raw session token or the GitHub access token", async () => {
    const token = await loginAs("code-allowed-2");
    const dump = await pool.query(
      `SELECT string_agg(t::text, '|') AS all_rows FROM (
         SELECT row_to_json(s)::text AS t FROM sessions s
         UNION ALL SELECT row_to_json(a)::text FROM audit_events a
         UNION ALL SELECT row_to_json(u)::text FROM users u
         UNION ALL SELECT row_to_json(o)::text FROM oauth_login_states o) x`,
    );
    const all = String(dump.rows[0].all_rows);
    expect(all).not.toContain(token);
    expect(all).not.toContain(FAKE_ACCESS_TOKEN);
  });

  it("returns 401 without a session", async () => {
    await request(app.getHttpServer()).get("/auth/me").expect(401);
    await request(app.getHttpServer()).get("/auth/me").set("Cookie", `${SESSION_COOKIE}=${"a".repeat(43)}`).expect(401);
  });

  it("rejects an expired session", async () => {
    const token = await loginAs("code-allowed");
    await pool.query("UPDATE sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 minute' WHERE revoked_at IS NULL");
    await request(app.getHttpServer()).get("/auth/me").set("Cookie", `${SESSION_COOKIE}=${token}`).expect(401);
  });

  it("revokes the previous session when logging in again (no fixation/reuse)", async () => {
    const first = await loginAs("code-allowed");
    const { state } = await startLogin();
    const res = await request(app.getHttpServer())
      .get(`/auth/github/callback?code=code-allowed&state=${state}`)
      .set("Cookie", `${OAUTH_STATE_COOKIE}=${state}; ${SESSION_COOKIE}=${first}`)
      .expect(303);
    const second = cookieFrom(res, SESSION_COOKIE)!;
    expect(second).not.toBe(first);
    await request(app.getHttpServer()).get("/auth/me").set("Cookie", `${SESSION_COOKIE}=${first}`).expect(401);
    await request(app.getHttpServer()).get("/auth/me").set("Cookie", `${SESSION_COOKIE}=${second}`).expect(200);
  });
});

describe("POST /auth/logout", () => {
  it("revokes the session server-side; the old cookie stops working", async () => {
    const token = await loginAs("code-allowed");
    const res = await request(app.getHttpServer()).post("/auth/logout").set("Origin", ORIGIN).set("Cookie", `${SESSION_COOKIE}=${token}`).expect(303);
    expect(res.headers.location).toBe("/login");
    expect(setCookieLine(res, SESSION_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/);
    await request(app.getHttpServer()).get("/auth/me").set("Cookie", `${SESSION_COOKIE}=${token}`).expect(401);
    const revoked = await pool.query("SELECT count(*)::int AS n FROM sessions WHERE revoked_at IS NOT NULL");
    expect(revoked.rows[0].n).toBeGreaterThan(0);
  });

  it("rejects cross-site logout (Origin mismatch or missing) — CSRF", async () => {
    const token = await loginAs("code-allowed");
    await request(app.getHttpServer()).post("/auth/logout").set("Origin", "https://evil.example.net").set("Cookie", `${SESSION_COOKIE}=${token}`).expect(403);
    await request(app.getHttpServer()).post("/auth/logout").set("Cookie", `${SESSION_COOKIE}=${token}`).expect(403);
    await request(app.getHttpServer()).get("/auth/me").set("Cookie", `${SESSION_COOKIE}=${token}`).expect(200);
  });

  it("is not available via GET", async () => {
    await request(app.getHttpServer()).get("/auth/logout").expect(404);
  });
});
