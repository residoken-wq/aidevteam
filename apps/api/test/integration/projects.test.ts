import type { INestApplication } from "@nestjs/common";
import { createPool, grantRole, migrateUp, seed, type Pool } from "@aidevteam/db";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GithubOAuthClient } from "../../src/auth/github-client";
import { createApp } from "../../src/bootstrap";
import { SESSION_COOKIE } from "../../src/cookies";
import { testConfig } from "../helpers";

/**
 * P2-10 project CRUD. Fake data only:
 *   900000001 org_admin  org-test-a
 *   900000002 viewer     org-test-a
 *   900000003 maintainer org-test-a
 *   900000004 maintainer org-test-b
 */
const ORIGIN = "https://cc.example.com";
const FAKE_TOKEN = "ghp_" + "P2x10FakeFakeFakeFakeFakeFakeFake1234";
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

async function auditCount(action: string, slug?: string): Promise<number> {
  const r = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM audit_events WHERE action = $1 AND ($2::text IS NULL OR metadata->>'slug' = $2)",
    [action, slug ?? null],
  );
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
  await grantRole(pool, 900000004, "org-test-b", "maintainer");
  tokens.admin = await sessionFor(900000001);
  tokens.viewer = await sessionFor(900000002);
  tokens.maintA = await sessionFor(900000003);
  tokens.maintB = await sessionFor(900000004);
  app = await createApp({ config: testConfig(), pool, githubClient: noGithub });
  await app.init();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("AC-1 CRUD with the right role", () => {
  it("maintainer creates, reads, lists, updates and archives a project", async () => {
    const created = await write("post", "/projects", "maintA").send({ slug: "control-center", name: "Control Center", description: "Release 0.1" }).expect(201);
    expect(created.body).toMatchObject({ slug: "control-center", name: "Control Center", description: "Release 0.1", archivedAt: null });
    expect(created.body).not.toHaveProperty("id");
    expect(created.body).not.toHaveProperty("orgId");

    expect((await api().get("/projects/control-center").set("Cookie", as("maintA")).expect(200)).body.name).toBe("Control Center");
    expect((await api().get("/projects").set("Cookie", as("maintA")).expect(200)).body.items.map((p: { slug: string }) => p.slug)).toContain("control-center");

    const updated = await write("patch", "/projects/control-center", "maintA").send({ name: "Control Center 0.1", description: null }).expect(200);
    expect(updated.body).toMatchObject({ name: "Control Center 0.1", description: null });

    const archived = await write("post", "/projects/control-center/archive", "maintA").expect(200);
    expect(archived.body.archivedAt).not.toBeNull();
    const active = await api().get("/projects").set("Cookie", as("maintA")).expect(200);
    expect(active.body.items.map((p: { slug: string }) => p.slug)).not.toContain("control-center");
    const all = await api().get("/projects?archived=true").set("Cookie", as("maintA")).expect(200);
    expect(all.body.items.map((p: { slug: string }) => p.slug)).toContain("control-center");
  });

  it("org_admin can also write", async () => {
    await write("post", "/projects", "admin").send({ slug: "admin-project", name: "Admin Project" }).expect(201);
  });
});

describe("AC-2 missing permission", () => {
  it("viewer can read but every write is 403", async () => {
    await write("post", "/projects", "maintA").send({ slug: "viewer-target", name: "Viewer Target" }).expect(201);
    await api().get("/projects").set("Cookie", as("viewer")).expect(200);
    await api().get("/projects/viewer-target").set("Cookie", as("viewer")).expect(200);
    await write("post", "/projects", "viewer").send({ slug: "by-viewer", name: "By Viewer" }).expect(403);
    await write("patch", "/projects/viewer-target", "viewer").send({ name: "Hijacked" }).expect(403);
    await write("post", "/projects/viewer-target/archive", "viewer").expect(403);
    expect((await api().get("/projects/viewer-target").set("Cookie", as("viewer")).expect(200)).body.name).toBe("Viewer Target");
  });

  it("401 without a session", async () => {
    await api().get("/projects").expect(401);
    await api().post("/projects").set("Origin", ORIGIN).send({ slug: "anon", name: "Anon" }).expect(401);
  });

  it("writes without a matching Origin are refused (CSRF)", async () => {
    await api().post("/projects").set("Cookie", as("maintA")).send({ slug: "no-origin", name: "No Origin" }).expect(403);
    await api().post("/projects").set("Origin", "https://evil.example.net").set("Cookie", as("maintA")).send({ slug: "evil", name: "Evil" }).expect(403);
  });
});

describe("AC-3 cross-org isolation", () => {
  it("org B cannot see, read, update or archive org A's project — 404, nothing leaks", async () => {
    await write("post", "/projects", "maintA").send({ slug: "secret-a", name: "Secret A", description: "org A only" }).expect(201);
    const list = await api().get("/projects?archived=true").set("Cookie", as("maintB")).expect(200);
    expect(JSON.stringify(list.body)).not.toContain("secret-a");
    const get = await api().get("/projects/secret-a").set("Cookie", as("maintB")).expect(404);
    expect(JSON.stringify(get.body)).not.toContain("org A only");
    await write("patch", "/projects/secret-a", "maintB").send({ name: "Taken over" }).expect(404);
    await write("post", "/projects/secret-a/archive", "maintB").expect(404);
    expect((await api().get("/projects/secret-a").set("Cookie", as("maintA")).expect(200)).body).toMatchObject({ name: "Secret A", archivedAt: null });
  });

  it("the same slug can exist in two orgs independently", async () => {
    await write("post", "/projects", "maintB").send({ slug: "secret-a", name: "Secret A" }).expect(201);
    const b = await api().get("/projects/secret-a").set("Cookie", as("maintB")).expect(200);
    expect(b.body.description).toBeNull();
  });

  it("org id in the body is rejected (422), not honoured", async () => {
    const orgB = (await pool.query("SELECT id FROM orgs WHERE slug = 'org-test-b'")).rows[0].id;
    await write("post", "/projects", "maintA").send({ slug: "smuggled", name: "Smuggled", orgId: orgB }).expect(422);
    await write("post", "/projects", "maintA").send({ slug: "smuggled", name: "Smuggled", org_id: orgB }).expect(422);
    expect((await pool.query("SELECT count(*)::int AS n FROM projects WHERE slug = 'smuggled'")).rows[0].n).toBe(0);
  });
});

describe("AC-4 validation", () => {
  it("422 with field paths, never echoing the submitted value", async () => {
    const res = await write("post", "/projects", "maintA").send({ slug: `bad slug ${FAKE_TOKEN}`, name: "" }).expect(422);
    expect(res.body.message).toBe("validation_failed");
    expect(res.body.issues.map((i: { path: string }) => i.path).sort()).toEqual(["name", "slug"]);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_TOKEN);
  });

  it("422 for an empty update and for changing the slug", async () => {
    await write("post", "/projects", "maintA").send({ slug: "immutable", name: "Immutable" }).expect(201);
    await write("patch", "/projects/immutable", "maintA").send({}).expect(422);
    await write("patch", "/projects/immutable", "maintA").send({ slug: "renamed" }).expect(422);
  });

  it("422 for an oversized page and unknown query params", async () => {
    await api().get("/projects?limit=1000").set("Cookie", as("maintA")).expect(422);
    await api().get("/projects?org_id=x").set("Cookie", as("maintA")).expect(422);
  });

  it("malformed slugs in the URL are 404, not 500", async () => {
    await api().get("/projects/..%2F..%2Fetc").set("Cookie", as("maintA")).expect(404);
  });
});

describe("AC-5 exactly one audit event per change", () => {
  it("create / update / archive each write one event with field names only", async () => {
    await write("post", "/projects", "maintA").send({ slug: "audited", name: "Audited" }).expect(201);
    await write("patch", "/projects/audited", "maintA").send({ description: `private note ${FAKE_TOKEN}` }).expect(200);
    await write("post", "/projects/audited/archive", "maintA").expect(200);
    expect(await auditCount("project.created", "audited")).toBe(1);
    expect(await auditCount("project.updated", "audited")).toBe(1);
    expect(await auditCount("project.archived", "audited")).toBe(1);
    const meta = await pool.query("SELECT metadata::text AS m FROM audit_events WHERE action = 'project.updated' AND metadata->>'slug' = 'audited'");
    expect(meta.rows[0].m).toContain('"fields": "description"');
    expect(meta.rows[0].m).not.toContain(FAKE_TOKEN);
  });

  it("rejected writes leave no audit event", async () => {
    const before = await auditCount("project.created");
    await write("post", "/projects", "viewer").send({ slug: "nope", name: "Nope" }).expect(403);
    await write("post", "/projects", "maintA").send({ slug: "x", name: "" }).expect(422);
    expect(await auditCount("project.created")).toBe(before);
  });
});

describe("conflicts", () => {
  it("duplicate slug or case-insensitive duplicate name in the same org → 409", async () => {
    await write("post", "/projects", "maintA").send({ slug: "dup", name: "Duplicate Me" }).expect(201);
    await write("post", "/projects", "maintA").send({ slug: "dup", name: "Other" }).expect(409);
    await write("post", "/projects", "maintA").send({ slug: "dup-2", name: "duplicate me" }).expect(409);
    await write("post", "/projects", "maintA").send({ slug: "dup-3", name: "Unique" }).expect(201);
    await write("patch", "/projects/dup-3", "maintA").send({ name: "DUPLICATE ME" }).expect(409);
  });

  it("archived projects cannot be archived again or edited", async () => {
    await write("post", "/projects", "maintA").send({ slug: "done", name: "Done" }).expect(201);
    await write("post", "/projects/done/archive", "maintA").expect(200);
    await write("post", "/projects/done/archive", "maintA").expect(409);
    await write("patch", "/projects/done", "maintA").send({ name: "Revived" }).expect(409);
  });

  it("paginates", async () => {
    const page = await api().get("/projects?limit=2&offset=0").set("Cookie", as("maintA")).expect(200);
    expect(page.body.items).toHaveLength(2);
    expect(page.body).toMatchObject({ limit: 2, offset: 0 });
  });
});
