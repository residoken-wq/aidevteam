import type { INestApplication } from "@nestjs/common";
import { createPool, grantPlatformAdmin, grantRole, migrateUp, revokePlatformAdmin, seed, type Pool } from "@aidevteam/db";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GithubOAuthClient } from "../../src/auth/github-client";
import { createApp } from "../../src/bootstrap";
import { SESSION_COOKIE } from "../../src/cookies";
import { testConfig } from "../helpers";

/**
 * P2-03 org management by platform admins. Fake data only:
 *   900000001 org_admin  org-test-a (not a platform admin)
 *   900000002 viewer     org-test-a
 *   900000005 platform admin, no org role
 *   900000006 maintainer in two orgs created by the tests (archive behaviour)
 *   900000007 maintainer in one org created by the tests (archive behaviour)
 */
const ORIGIN = "https://cc.example.com";
const noGithub: GithubOAuthClient = {
  exchangeCodeForIdentity: async () => {
    throw new Error("not used");
  },
};

let pool: Pool;
let app: INestApplication;
const tokens: Record<string, string> = {};

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
const api = () => request(app.getHttpServer());
const write = (method: "post" | "patch", path: string, who: string) => api()[method](path).set("Origin", ORIGIN).set("Cookie", as(who));

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test$/.test(new URL(url).pathname.slice(1))) throw new Error("TEST_DATABASE_URL with a *_test database is required");
  pool = createPool(url, { max: 5 });
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrateUp(pool);
  await seed(pool, { NODE_ENV: "test" });
  for (const id of [900000005, 900000006, 900000007]) await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake')", [id]);
  await grantRole(pool, 900000001, "org-test-a", "org_admin");
  await grantRole(pool, 900000002, "org-test-a", "viewer");
  await grantPlatformAdmin(pool, 900000005, "test");
  await grantRole(pool, 900000006, "org-test-a", "maintainer");
  tokens.admin = await sessionFor(900000001);
  tokens.viewer = await sessionFor(900000002);
  tokens.platform = await sessionFor(900000005);
  tokens.multi = await sessionFor(900000006);
  app = await createApp({ config: testConfig(), pool, githubClient: noGithub });
  await app.init();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("AC-1 platform admin manages orgs", () => {
  it("creates, reads, lists, renames, archives and restores an org", async () => {
    const created = await write("post", "/platform/orgs", "platform").send({ slug: "org-new", name: "  Org New  " }).expect(201);
    expect(created.body).toMatchObject({ slug: "org-new", name: "Org New", archivedAt: null });
    expect(created.body).not.toHaveProperty("id");
    expect((await api().get("/platform/orgs/org-new").set("Cookie", as("platform")).expect(200)).body.name).toBe("Org New");
    const renamed = await write("patch", "/platform/orgs/org-new", "platform").send({ name: "Org Renamed" }).expect(200);
    expect(renamed.body.name).toBe("Org Renamed");
    const archived = await write("post", "/platform/orgs/org-new/archive", "platform").expect(200);
    expect(archived.body.archivedAt).not.toBeNull();
    const active = await api().get("/platform/orgs").set("Cookie", as("platform")).expect(200);
    expect(active.body.items.map((o: { slug: string }) => o.slug)).not.toContain("org-new");
    const all = await api().get("/platform/orgs?archived=true").set("Cookie", as("platform")).expect(200);
    expect(all.body.items.map((o: { slug: string }) => o.slug)).toEqual(expect.arrayContaining(["org-new", "org-test-a", "org-test-b"]));
    const restored = await write("post", "/platform/orgs/org-new/restore", "platform").expect(200);
    expect(restored.body.archivedAt).toBeNull();
  });

  it("/auth/me shows platform permissions only for platform admins", async () => {
    const p = await api().get("/auth/me").set("Cookie", as("platform")).expect(200);
    expect(p.body.platformPermissions).toEqual(["platform:org:read", "platform:org:write"]);
    expect(p.body.activeOrg).toBeNull();
    const a = await api().get("/auth/me").set("Cookie", as("admin")).expect(200);
    expect(a.body.platformPermissions).toEqual([]);
  });
});

describe("AC-2 nobody else, and no implicit org access", () => {
  it("org_admin and viewer get 403 on every platform route, audited", async () => {
    for (const who of ["admin", "viewer"]) {
      await api().get("/platform/orgs").set("Cookie", as(who)).expect(403);
      await api().get("/platform/orgs/org-test-a").set("Cookie", as(who)).expect(403);
      await write("post", "/platform/orgs", who).send({ slug: `by-${who}`, name: "Nope" }).expect(403);
      await write("patch", "/platform/orgs/org-test-a", who).send({ name: "Hijacked" }).expect(403);
      await write("post", "/platform/orgs/org-test-a/archive", who).expect(403);
      await write("post", "/platform/orgs/org-test-a/restore", who).expect(403);
    }
    const denied = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'rbac.denied' AND metadata->>'reason' = 'not_platform_admin'");
    expect(denied.rows[0].n).toBe(12);
    expect((await pool.query("SELECT name, archived_at FROM orgs WHERE slug = 'org-test-a'")).rows[0]).toEqual({ name: expect.not.stringContaining("Hijacked"), archived_at: null });
  });

  it("401 without session, 403 without matching Origin", async () => {
    await api().get("/platform/orgs").expect(401);
    await api().post("/platform/orgs").set("Cookie", as("platform")).send({ slug: "no-origin", name: "x" }).expect(403);
    await api().post("/platform/orgs").set("Origin", "https://evil.example.net").set("Cookie", as("platform")).send({ slug: "evil", name: "x" }).expect(403);
  });

  it("a platform admin without an org role cannot read any org's data", async () => {
    for (const path of ["/projects", "/workers", "/provider-accounts", "/audit/events", "/org"]) {
      await api().get(path).set("Cookie", as("platform")).expect(403);
    }
  });

  it("revoking platform admin by CLI takes effect on the next request", async () => {
    await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES (900000008, 'fake')");
    await grantPlatformAdmin(pool, 900000008);
    tokens.temp = await sessionFor(900000008);
    await api().get("/platform/orgs").set("Cookie", as("temp")).expect(200);
    await revokePlatformAdmin(pool, 900000008);
    await api().get("/platform/orgs").set("Cookie", as("temp")).expect(403);
  });
});

describe("AC-4 validation and conflicts", () => {
  it("422 for bad input, extra fields and slug changes; 409 for duplicates and state conflicts; 404 for unknown", async () => {
    await write("post", "/platform/orgs", "platform").send({ slug: "Bad Slug", name: "x" }).expect(422);
    await write("post", "/platform/orgs", "platform").send({ slug: "ok-org", name: "" }).expect(422);
    await write("post", "/platform/orgs", "platform").send({ slug: "ok-org", name: "x", id: "00000000-0000-0000-0000-000000000000" }).expect(422);
    await write("post", "/platform/orgs", "platform").send({ slug: "org-test-a", name: "Dup" }).expect(409);
    await write("patch", "/platform/orgs/org-test-a", "platform").send({ slug: "renamed" }).expect(422);
    await write("post", "/platform/orgs/org-test-a/restore", "platform").expect(409);
    await write("post", "/platform/orgs", "platform").send({ slug: "org-twice", name: "Twice" }).expect(201);
    await write("post", "/platform/orgs/org-twice/archive", "platform").expect(200);
    await write("post", "/platform/orgs/org-twice/archive", "platform").expect(409);
    await write("patch", "/platform/orgs/org-twice", "platform").send({ name: "Edited" }).expect(409);
    await api().get("/platform/orgs/no-such-org").set("Cookie", as("platform")).expect(404);
    await api().get("/platform/orgs/..%2Fetc").set("Cookie", as("platform")).expect(404);
    await api().get("/platform/orgs?limit=1000").set("Cookie", as("platform")).expect(422);
  });
});

describe("AC-5 one audit event per change, scoped to the target org", () => {
  it("records created / updated / archived / restored with the org id and no values", async () => {
    await write("post", "/platform/orgs", "platform").send({ slug: "org-audited", name: "Audited" }).expect(201);
    await write("patch", "/platform/orgs/org-audited", "platform").send({ name: "Audited private name" }).expect(200);
    await write("post", "/platform/orgs/org-audited/archive", "platform").expect(200);
    await write("post", "/platform/orgs/org-audited/restore", "platform").expect(200);
    const r = await pool.query(
      `SELECT a.action, a.metadata, a.org_id = o.id AS scoped, a.actor_github_user_id
         FROM audit_events a JOIN orgs o ON o.slug = 'org-audited'
        WHERE a.target_type = 'org' AND a.target_id = o.id::text ORDER BY a.id`,
    );
    expect(r.rows.map((x) => x.action)).toEqual(["org.created", "org.updated", "org.archived", "org.restored"]);
    expect(r.rows.every((x) => x.scoped && Number(x.actor_github_user_id) === 900000005)).toBe(true);
    expect(r.rows[1].metadata).toEqual({ slug: "org-audited", via: "platform", fields: "name" });
    expect(JSON.stringify(r.rows)).not.toContain("private name");
  });
});

describe("archived org: access blocked, session kept, data retained (decision 26/11)", () => {
  it("single-org member loses access but stays signed in; restore brings access back with data intact", async () => {
    await write("post", "/platform/orgs", "platform").send({ slug: "org-arch", name: "Org Arch" }).expect(201);
    await grantRole(pool, 900000007, "org-arch", "maintainer");
    tokens.single = await sessionFor(900000007);
    await write("post", "/projects", "single").send({ slug: "kept", name: "Kept" }).expect(201);

    await write("post", "/platform/orgs/org-arch/archive", "platform").expect(200);
    await api().get("/projects").set("Cookie", as("single")).expect(403);
    await write("post", "/projects", "single").send({ slug: "after", name: "After" }).expect(403);
    const me = await api().get("/auth/me").set("Cookie", as("single")).expect(200);
    expect(me.body).toMatchObject({ orgs: [], activeOrg: null });
    const s = await pool.query("SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.github_user_id = 900000007 AND s.revoked_at IS NULL");
    expect(s.rows[0].n).toBe(1);

    await write("post", "/platform/orgs/org-arch/restore", "platform").expect(200);
    const list = await api().get("/projects").set("Cookie", as("single")).expect(200);
    expect(list.body.items.map((p: { slug: string }) => p.slug)).toEqual(["kept"]);
  });

  it("multi-org member whose active org is archived falls back to the remaining org", async () => {
    await write("post", "/platform/orgs", "platform").send({ slug: "org-second", name: "Org Second" }).expect(201);
    await grantRole(pool, 900000006, "org-second", "maintainer");
    await api().post("/auth/active-org").set("Origin", ORIGIN).set("Cookie", as("multi")).type("form").send({ orgSlug: "org-second" }).expect(303);
    expect((await api().get("/auth/me").set("Cookie", as("multi")).expect(200)).body.activeOrg.slug).toBe("org-second");
    await write("post", "/platform/orgs/org-second/archive", "platform").expect(200);
    const me = await api().get("/auth/me").set("Cookie", as("multi")).expect(200);
    expect(me.body.activeOrg.slug).toBe("org-test-a");
    expect(me.body.orgs.map((o: { slug: string }) => o.slug)).toEqual(["org-test-a"]);
    await api().post("/auth/active-org").set("Origin", ORIGIN).set("Cookie", as("multi")).type("form").send({ orgSlug: "org-second" }).expect(403);
  });
});
