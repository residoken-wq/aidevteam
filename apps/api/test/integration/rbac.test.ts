import { Controller, Get, type INestApplication } from "@nestjs/common";
import { createPool, grantRole, migrateUp, revokeRole, seed, type Pool } from "@aidevteam/db";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GithubOAuthClient } from "../../src/auth/github-client";
import { createApp } from "../../src/bootstrap";
import { SESSION_COOKIE } from "../../src/cookies";
import { testConfig } from "../helpers";

/**
 * P1-06 RBAC + login rate limit. Fake data only:
 *   900000001 org_admin  in org-test-a
 *   900000002 viewer     in org-test-a
 *   900000003 maintainer in org-test-a AND viewer in org-test-b (must choose an org)
 *   900000004 allowlisted, no role
 */
const ORIGIN = "https://cc.example.com";

@Controller("__probe")
class UndeclaredController {
  // Deliberately no @Public / @Authenticated / @RequirePermission.
  @Get("undeclared")
  undeclared() {
    return { leaked: true };
  }
}

const noGithub: GithubOAuthClient = {
  exchangeCodeForIdentity: async () => {
    throw new Error("not used");
  },
};

let pool: Pool;
let app: INestApplication;
let proxiedApp: INestApplication;
const tokens: Record<string, string> = {};
let orgA = "";
let orgB = "";

async function sessionFor(githubUserId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     SELECT id, $2, now() + interval '1 hour' FROM users WHERE github_user_id = $1`,
    [githubUserId, createHash("sha256").update(token).digest()],
  );
  return token;
}

const as = (who: string) => `${SESSION_COOKIE}=${tokens[who]}`;

async function deniedCount(reason: string): Promise<number> {
  const r = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_events WHERE action = 'rbac.denied' AND metadata->>'reason' = $1", [reason]);
  return r.rows[0]!.n;
}

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test$/.test(new URL(url).pathname.slice(1))) throw new Error("TEST_DATABASE_URL with a *_test database is required");
  pool = createPool(url, { max: 5 });
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrateUp(pool);
  await seed(pool, { NODE_ENV: "test" });
  for (const id of [900000003, 900000004]) await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake')", [id]);
  await grantRole(pool, 900000001, "org-test-a", "org_admin");
  await grantRole(pool, 900000002, "org-test-a", "viewer");
  await grantRole(pool, 900000003, "org-test-a", "maintainer");
  await grantRole(pool, 900000003, "org-test-b", "viewer");
  await pool.query("INSERT INTO users (github_user_id, github_login) VALUES (900000004, 'test-user-04') ON CONFLICT DO NOTHING");
  orgA = (await pool.query("SELECT id FROM orgs WHERE slug = 'org-test-a'")).rows[0].id;
  orgB = (await pool.query("SELECT id FROM orgs WHERE slug = 'org-test-b'")).rows[0].id;
  tokens.admin = await sessionFor(900000001);
  tokens.viewer = await sessionFor(900000002);
  tokens.multi = await sessionFor(900000003);
  tokens.norole = await sessionFor(900000004);
  app = await createApp({ config: testConfig(), pool, githubClient: noGithub, extraControllers: [UndeclaredController] });
  await app.init();
  proxiedApp = await createApp({ config: testConfig({ trustedProxies: ["loopback"] }), pool, githubClient: noGithub });
  await proxiedApp.init();
});

afterAll(async () => {
  await app.close();
  await proxiedApp.close();
  await pool.end();
});

describe("default deny", () => {
  it("401 without a session on protected routes", async () => {
    await request(app.getHttpServer()).get("/org").expect(401);
    await request(app.getHttpServer()).get("/audit/events").expect(401);
    await request(app.getHttpServer()).get("/auth/me").expect(401);
  });

  it("a route without an access rule is forbidden even for org_admin, and audited", async () => {
    const before = await deniedCount("no_access_rule");
    const res = await request(app.getHttpServer()).get("/__probe/undeclared").set("Cookie", as("admin")).expect(403);
    expect(JSON.stringify(res.body)).not.toContain("leaked");
    expect(await deniedCount("no_access_rule")).toBe(before + 1);
  });

  it("signed in without any role → 403 no_role on permission routes; /auth/me still works", async () => {
    const res = await request(app.getHttpServer()).get("/org").set("Cookie", as("norole")).expect(403);
    expect(res.body.message).toBe("no_role");
    const me = await request(app.getHttpServer()).get("/auth/me").set("Cookie", as("norole")).expect(200);
    expect(me.body.activeOrg).toBeNull();
  });
});

describe("permissions per role", () => {
  it.each([
    ["admin", "/org", 200],
    ["admin", "/audit/events", 200],
    ["viewer", "/org", 200],
    ["viewer", "/audit/events", 403],
  ] as const)("%s GET %s → %i", async (who, path, status) => {
    await request(app.getHttpServer()).get(path).set("Cookie", as(who)).expect(status);
  });

  it("viewer denial is audited with the missing permission", async () => {
    await request(app.getHttpServer()).get("/audit/events").set("Cookie", as("viewer")).expect(403);
    const r = await pool.query("SELECT metadata FROM audit_events WHERE action = 'rbac.denied' ORDER BY id DESC LIMIT 1");
    expect(r.rows[0].metadata).toEqual({ reason: "missing_permission", permission: "audit:read" });
  });

  it("/auth/me exposes the effective permissions of the active org", async () => {
    const me = await request(app.getHttpServer()).get("/auth/me").set("Cookie", as("viewer")).expect(200);
    expect(me.body.activeOrg.slug).toBe("org-test-a");
    expect(me.body.activeOrg.permissions).not.toContain("audit:read");
    expect(me.body.activeOrg.permissions.some((p: string) => p.endsWith(":write"))).toBe(false);
  });
});

describe("tenant isolation (cross-org)", () => {
  let eventB = 0;
  beforeAll(async () => {
    eventB = Number(
      (await pool.query("INSERT INTO audit_events (org_id, action) VALUES ($1, 'test.org_b_secret') RETURNING id", [orgB])).rows[0].id,
    );
    await pool.query("INSERT INTO audit_events (org_id, action) VALUES ($1, 'test.org_a_event')", [orgA]);
  });

  it("org_admin of A only sees A's audit events", async () => {
    const res = await request(app.getHttpServer()).get("/audit/events?limit=200").set("Cookie", as("admin")).expect(200);
    const actions = (res.body as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain("test.org_a_event");
    expect(actions).not.toContain("test.org_b_secret");
  });

  it("guessing another org's event id returns 404 (no existence leak)", async () => {
    const res = await request(app.getHttpServer()).get(`/audit/events/${eventB}`).set("Cookie", as("admin")).expect(404);
    expect(JSON.stringify(res.body)).not.toContain("org_b_secret");
  });

  it("org id in query string is ignored — scope comes from the session", async () => {
    const res = await request(app.getHttpServer()).get(`/audit/events?org_id=${orgB}&orgId=${orgB}`).set("Cookie", as("admin")).expect(200);
    expect((res.body as Array<{ action: string }>).map((e) => e.action)).not.toContain("test.org_b_secret");
  });
});

describe("multi-org users and active org", () => {
  it("must choose an org before using permission routes", async () => {
    const res = await request(app.getHttpServer()).get("/org").set("Cookie", as("multi")).expect(403);
    expect(res.body.message).toBe("org_selection_required");
  });

  it("can switch only to an org they belong to (Origin required)", async () => {
    await request(app.getHttpServer()).post("/auth/active-org").set("Cookie", as("multi")).send({ orgSlug: "org-test-b" }).expect(403);
    await request(app.getHttpServer()).post("/auth/active-org").set("Origin", ORIGIN).set("Cookie", as("multi")).send({ orgSlug: "no-such-org" }).expect(403);
    await request(app.getHttpServer()).post("/auth/active-org").set("Origin", ORIGIN).set("Cookie", as("multi")).send({ orgId: orgB }).expect(403);
    await request(app.getHttpServer()).post("/auth/active-org").set("Origin", ORIGIN).set("Cookie", as("multi")).send({ orgSlug: "org-test-b" }).expect(303);
    const org = await request(app.getHttpServer()).get("/org").set("Cookie", as("multi")).expect(200);
    expect(org.body).toEqual({ slug: "org-test-b", name: "Org Test B" });
  });

  it("accepts the browser form encoding", async () => {
    await request(app.getHttpServer())
      .post("/auth/active-org")
      .set("Origin", ORIGIN)
      .set("Cookie", as("multi"))
      .type("form")
      .send("orgSlug=org-test-a")
      .expect(303);
    expect((await request(app.getHttpServer()).get("/org").set("Cookie", as("multi")).expect(200)).body.slug).toBe("org-test-a");
    await request(app.getHttpServer()).post("/auth/active-org").set("Origin", ORIGIN).set("Cookie", as("multi")).send({ orgSlug: "org-test-b" }).expect(303);
  });

  it("role changes apply on the next request (memberships are re-read)", async () => {
    await revokeRole(pool, 900000003, "org-test-b", "viewer");
    // Active org B is no longer valid; only org A remains → resolves to A.
    const org = await request(app.getHttpServer()).get("/org").set("Cookie", as("multi")).expect(200);
    expect(org.body.slug).toBe("org-test-a");
    await revokeRole(pool, 900000003, "org-test-a", "maintainer");
    await request(app.getHttpServer()).get("/org").set("Cookie", as("multi")).expect(403);
  });
});

describe("login rate limit — 5 per 15 minutes per IP (D-2026-11-26-02)", () => {
  beforeEach(async () => {
    await pool.query("DELETE FROM rate_limit_hits");
  });

  it("allows 5 login starts, then 429 with Retry-After, audited", async () => {
    for (let i = 0; i < 5; i++) await request(app.getHttpServer()).get("/auth/github/login").expect(302);
    const before = (await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'auth.rate_limited'")).rows[0].n;
    const res = await request(app.getHttpServer()).get("/auth/github/login").expect(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(res.headers["retry-after"])).toBeLessThanOrEqual(900);
    expect(res.headers.location).toBeUndefined();
    const after = (await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'auth.rate_limited'")).rows[0].n;
    expect(after).toBe(before + 1);
  });

  it("a spoofed X-Forwarded-For from an untrusted hop does not bypass the limit", async () => {
    for (let i = 0; i < 5; i++) await request(app.getHttpServer()).get("/auth/github/login").set("X-Forwarded-For", `203.0.113.${i}`).expect(302);
    await request(app.getHttpServer()).get("/auth/github/login").set("X-Forwarded-For", "203.0.113.99").expect(429);
  });

  it("behind a trusted proxy, clients are counted separately by forwarded IP", async () => {
    for (let i = 0; i < 5; i++) await request(proxiedApp.getHttpServer()).get("/auth/github/login").set("X-Forwarded-For", "198.51.100.1").expect(302);
    await request(proxiedApp.getHttpServer()).get("/auth/github/login").set("X-Forwarded-For", "198.51.100.1").expect(429);
    await request(proxiedApp.getHttpServer()).get("/auth/github/login").set("X-Forwarded-For", "198.51.100.2").expect(302);
  });

  it("stores only a hash of the client IP", async () => {
    await request(proxiedApp.getHttpServer()).get("/auth/github/login").set("X-Forwarded-For", "198.51.100.7");
    const dump = await pool.query("SELECT string_agg(row_to_json(r)::text, '|') AS t FROM rate_limit_hits r");
    expect(String(dump.rows[0].t)).not.toContain("198.51.100.7");
  });
});
