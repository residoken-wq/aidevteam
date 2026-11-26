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
 * P2-08 workers (mock only). Fake data only:
 *   900000002 viewer     org-test-a
 *   900000003 maintainer org-test-a
 *   900000004 maintainer org-test-b
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
const valid = (slug: string, path = `/srv/workspaces/${slug}`) => ({ slug, name: `Worker ${slug}`, type: "mock", workspacePath: path });

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test$/.test(new URL(url).pathname.slice(1))) throw new Error("TEST_DATABASE_URL with a *_test database is required");
  pool = createPool(url, { max: 10 });
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrateUp(pool);
  await seed(pool, { NODE_ENV: "test" });
  for (const id of [900000003, 900000004]) await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake')", [id]);
  await grantRole(pool, 900000002, "org-test-a", "viewer");
  await grantRole(pool, 900000003, "org-test-a", "maintainer");
  await grantRole(pool, 900000004, "org-test-b", "maintainer");
  tokens.viewer = await sessionFor(900000002);
  tokens.maintA = await sessionFor(900000003);
  tokens.maintB = await sessionFor(900000004);
  app = await createApp({ config: testConfig(), pool, githubClient: noGithub });
  await app.init();
  await write("post", "/projects", "maintA").send({ slug: "proj-a", name: "Project A" }).expect(201);
  await write("post", "/projects", "maintB").send({ slug: "proj-b", name: "Project B" }).expect(201);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("AC-1 CRUD with the right role", () => {
  it("maintainer creates, attaches a project, disables and archives a worker", async () => {
    const created = await write("post", "/workers", "maintA").send({ ...valid("mock-1"), projectSlug: "proj-a" }).expect(201);
    expect(created.body).toMatchObject({ slug: "mock-1", type: "mock", workspacePath: "/srv/workspaces/mock-1", projectSlug: "proj-a", enabled: true, archivedAt: null });
    expect(created.body).not.toHaveProperty("id");
    expect(created.body).not.toHaveProperty("orgId");
    const updated = await write("patch", "/workers/mock-1", "maintA").send({ enabled: false, projectSlug: null, description: "paused" }).expect(200);
    expect(updated.body).toMatchObject({ enabled: false, projectSlug: null, description: "paused" });
    expect((await api().get("/workers/mock-1").set("Cookie", as("maintA")).expect(200)).body.enabled).toBe(false);
    const archived = await write("post", "/workers/mock-1/archive", "maintA").expect(200);
    expect(archived.body).toMatchObject({ enabled: false });
    expect(archived.body.archivedAt).not.toBeNull();
    const list = await api().get("/workers").set("Cookie", as("maintA")).expect(200);
    expect(list.body.items.map((w: { slug: string }) => w.slug)).not.toContain("mock-1");
    const all = await api().get("/workers?archived=true").set("Cookie", as("maintA")).expect(200);
    expect(all.body.items.map((w: { slug: string }) => w.slug)).toContain("mock-1");
  });
});

describe("AC-2 missing permission", () => {
  it("viewer reads but cannot write", async () => {
    await write("post", "/workers", "maintA").send(valid("viewer-target")).expect(201);
    await api().get("/workers/viewer-target").set("Cookie", as("viewer")).expect(200);
    await write("post", "/workers", "viewer").send(valid("by-viewer")).expect(403);
    await write("patch", "/workers/viewer-target", "viewer").send({ enabled: false }).expect(403);
    await write("post", "/workers/viewer-target/archive", "viewer").expect(403);
    expect((await api().get("/workers/viewer-target").set("Cookie", as("viewer")).expect(200)).body.enabled).toBe(true);
  });

  it("401 without session, 403 without matching Origin", async () => {
    await api().get("/workers").expect(401);
    await api().post("/workers").set("Cookie", as("maintA")).send(valid("no-origin")).expect(403);
    await api().post("/workers").set("Origin", "https://evil.example.net").set("Cookie", as("maintA")).send(valid("evil")).expect(403);
  });
});

describe("AC-3 cross-org isolation", () => {
  it("org B cannot see or touch org A's worker", async () => {
    await write("post", "/workers", "maintA").send(valid("org-a-only")).expect(201);
    const list = await api().get("/workers?archived=true").set("Cookie", as("maintB")).expect(200);
    expect(JSON.stringify(list.body)).not.toContain("org-a-only");
    await api().get("/workers/org-a-only").set("Cookie", as("maintB")).expect(404);
    await write("patch", "/workers/org-a-only", "maintB").send({ enabled: false }).expect(404);
    await write("post", "/workers/org-a-only/archive", "maintB").expect(404);
    expect((await api().get("/workers/org-a-only").set("Cookie", as("maintA")).expect(200)).body.enabled).toBe(true);
  });

  it("another org's project cannot be attached (422, same as unknown)", async () => {
    const res = await write("post", "/workers", "maintA").send({ ...valid("steal-proj"), projectSlug: "proj-b" }).expect(422);
    expect(res.body.issues[0].path).toBe("projectSlug");
    await write("post", "/workers", "maintA").send({ ...valid("ghost-proj"), projectSlug: "no-such-project" }).expect(422);
    await write("post", "/workers", "maintA").send(valid("attach-later")).expect(201);
    await write("patch", "/workers/attach-later", "maintA").send({ projectSlug: "proj-b" }).expect(422);
  });

  it("workspace paths are scoped per org", async () => {
    await write("post", "/workers", "maintB").send(valid("org-b-same-path", "/srv/workspaces/org-a-only")).expect(201);
  });

  it("org id in the body is rejected", async () => {
    await write("post", "/workers", "maintA").send({ ...valid("smuggle"), orgId: "x" }).expect(422);
  });
});

describe("AC-4 workspace path safety (router v0.1 §6.2-4)", () => {
  it("same, parent or nested path of an active worker → 409", async () => {
    await write("post", "/workers", "maintA").send(valid("base", "/srv/ws/base")).expect(201);
    for (const p of ["/srv/ws/base", "/srv/ws/base/sub", "/srv/ws"]) {
      const res = await write("post", "/workers", "maintA").send(valid("clash", p)).expect(409);
      expect(res.body.message).toBe("workspace_path_in_use");
    }
    await write("post", "/workers", "maintA").send(valid("sibling", "/srv/ws/base-2")).expect(201);
  });

  it("archiving frees the path", async () => {
    await write("post", "/workers", "maintA").send(valid("old", "/srv/ws2/reuse")).expect(201);
    await write("post", "/workers", "maintA").send(valid("new", "/srv/ws2/reuse")).expect(409);
    await write("post", "/workers/old/archive", "maintA").expect(200);
    await write("post", "/workers", "maintA").send(valid("new", "/srv/ws2/reuse")).expect(201);
  });

  it("concurrent creates on the same path: exactly one wins", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => write("post", "/workers", "maintA").send(valid(`race-${i}`, i % 2 ? "/srv/race/a/b" : "/srv/race/a"))),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
  });

  it("create waits for the org-level lock, so the overlap check cannot interleave", async () => {
    const orgA = (await pool.query("SELECT id FROM orgs WHERE slug = 'org-test-a'")).rows[0].id;
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtext('workers:' || $1::text))", [orgA]);
      let settled = false;
      const pending = write("post", "/workers", "maintA").send(valid("locked", "/srv/locked/a")).then((r) => {
        settled = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false);
      // While held, plant a parent path directly: the waiting create must see it once the lock is released.
      await holder.query("INSERT INTO workers (org_id, slug, name, type, workspace_path) VALUES ($1, 'planted', 'Planted', 'mock', '/srv/locked')", [orgA]);
      await holder.query("COMMIT");
      expect((await pending).status).toBe(409);
    } finally {
      holder.release();
    }
  });

  it("relative, traversal, system and too-shallow paths → 422", async () => {
    for (const p of ["srv/ws", "/srv/../etc/x", "/etc/aidevteam", "/srv", "/usr/local/x", "/srv/ws x", "/srv/ws;rm"]) {
      await write("post", "/workers", "maintA").send(valid("bad-path", p)).expect(422);
    }
  });

  it("workspacePath and type are immutable", async () => {
    await write("post", "/workers", "maintA").send(valid("fixed", "/srv/fixed/one")).expect(201);
    await write("patch", "/workers/fixed", "maintA").send({ workspacePath: "/srv/fixed/two" }).expect(422);
    await write("patch", "/workers/fixed", "maintA").send({ type: "mock" }).expect(422);
  });
});

describe("AC-6 only mock workers in Release 0.1", () => {
  it("any other type → 422", async () => {
    for (const type of ["agy", "antigravity", "claude", "shell"]) {
      await write("post", "/workers", "maintA").send({ ...valid("real"), type }).expect(422);
    }
  });
});

describe("AC-5 audit and conflicts", () => {
  it("one event per change with field names only", async () => {
    await write("post", "/workers", "maintA").send(valid("audited")).expect(201);
    await write("patch", "/workers/audited", "maintA").send({ enabled: false, description: "private note" }).expect(200);
    await write("post", "/workers/audited/archive", "maintA").expect(200);
    const r = await pool.query("SELECT action, metadata FROM audit_events WHERE metadata->>'slug' = 'audited' AND action LIKE 'worker.%' ORDER BY id");
    expect(r.rows.map((x) => x.action)).toEqual(["worker.created", "worker.updated", "worker.archived"]);
    expect(r.rows[1].metadata).toEqual({ slug: "audited", fields: "description,enabled" });
    expect(JSON.stringify(r.rows)).not.toContain("private note");
  });

  it("rejected writes leave no audit event", async () => {
    const before = (await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'worker.created'")).rows[0].n;
    await write("post", "/workers", "viewer").send(valid("nope")).expect(403);
    await write("post", "/workers", "maintA").send({ ...valid("nope"), type: "agy" }).expect(422);
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'worker.created'")).rows[0].n).toBe(before);
  });

  it("duplicate slug → 409; archived worker cannot be edited or archived again", async () => {
    await write("post", "/workers", "maintA").send(valid("dup-w")).expect(201);
    await write("post", "/workers", "maintA").send(valid("dup-w", "/srv/workspaces/dup-w-2")).expect(409);
    await write("post", "/workers/dup-w/archive", "maintA").expect(200);
    await write("post", "/workers/dup-w/archive", "maintA").expect(409);
    await write("patch", "/workers/dup-w", "maintA").send({ enabled: true }).expect(409);
  });

  it("malformed slug in URL → 404, oversized page → 422", async () => {
    await api().get("/workers/..%2Fetc").set("Cookie", as("maintA")).expect(404);
    await api().get("/workers?limit=1000").set("Cookie", as("maintA")).expect(422);
  });
});
