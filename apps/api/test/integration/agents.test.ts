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
 * P2-05 agents (org chart). Fake data only:
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
const valid = (slug: string, extra: Record<string, unknown> = {}) => ({ slug, name: `Agent ${slug}`, ...extra });

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
  await write("post", "/provider-accounts", "maintA").send({ slug: "claude-a", name: "Claude A", provider: "anthropic", secretRef: "env:AIDEV_SECRET_CLAUDE_A" }).expect(201);
  await write("post", "/provider-accounts", "maintB").send({ slug: "claude-b", name: "Claude B", provider: "anthropic", secretRef: "env:AIDEV_SECRET_CLAUDE_B" }).expect(201);
  await write("post", "/agents", "maintB").send(valid("lead-b")).expect(201);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("AC-1 CRUD with the right role", () => {
  it("maintainer creates an org chart, edits and archives an agent", async () => {
    const lead = await write("post", "/agents", "maintA").send(valid("tech-lead", { title: "Tech Lead", model: "claude-sonnet-x.y", providerAccountSlug: "claude-a" })).expect(201);
    expect(lead.body).toMatchObject({ slug: "tech-lead", title: "Tech Lead", model: "claude-sonnet-x.y", providerAccountSlug: "claude-a", reportsToSlug: null, enabled: true, archivedAt: null });
    expect(lead.body).not.toHaveProperty("id");
    expect(JSON.stringify(lead.body)).not.toContain("AIDEV_SECRET");
    const dev = await write("post", "/agents", "maintA").send(valid("backend-dev", { reportsToSlug: "tech-lead" })).expect(201);
    expect(dev.body.reportsToSlug).toBe("tech-lead");
    const edited = await write("patch", "/agents/backend-dev", "maintA").send({ title: "Backend", model: null, enabled: false, reportsToSlug: null }).expect(200);
    expect(edited.body).toMatchObject({ title: "Backend", model: null, enabled: false, reportsToSlug: null });
    const archived = await write("post", "/agents/backend-dev/archive", "maintA").expect(200);
    expect(archived.body.archivedAt).not.toBeNull();
    const list = await api().get("/agents").set("Cookie", as("maintA")).expect(200);
    expect(list.body.items.map((a: { slug: string }) => a.slug)).toEqual(["tech-lead"]);
    const all = await api().get("/agents?archived=true").set("Cookie", as("maintA")).expect(200);
    expect(all.body.items.map((a: { slug: string }) => a.slug).sort()).toEqual(["backend-dev", "tech-lead"]);
  });
});

describe("AC-2 missing permission", () => {
  it("viewer reads but cannot write", async () => {
    await api().get("/agents/tech-lead").set("Cookie", as("viewer")).expect(200);
    await write("post", "/agents", "viewer").send(valid("by-viewer")).expect(403);
    await write("patch", "/agents/tech-lead", "viewer").send({ enabled: false }).expect(403);
    await write("post", "/agents/tech-lead/archive", "viewer").expect(403);
  });

  it("401 without session, 403 without matching Origin", async () => {
    await api().get("/agents").expect(401);
    await api().post("/agents").set("Cookie", as("maintA")).send(valid("no-origin")).expect(403);
  });
});

describe("AC-3 cross-org isolation", () => {
  it("org B cannot see or touch org A's agent", async () => {
    const list = await api().get("/agents?archived=true").set("Cookie", as("maintB")).expect(200);
    expect(list.body.items.map((a: { slug: string }) => a.slug)).toEqual(["lead-b"]);
    await api().get("/agents/tech-lead").set("Cookie", as("maintB")).expect(404);
    await write("patch", "/agents/tech-lead", "maintB").send({ name: "Taken" }).expect(404);
    await write("post", "/agents/tech-lead/archive", "maintB").expect(404);
  });

  it("another org's provider account or manager cannot be referenced (422, same as unknown)", async () => {
    const r1 = await write("post", "/agents", "maintA").send(valid("x-pa", { providerAccountSlug: "claude-b" })).expect(422);
    expect(r1.body.issues[0].path).toBe("providerAccountSlug");
    const r2 = await write("post", "/agents", "maintA").send(valid("x-mgr", { reportsToSlug: "lead-b" })).expect(422);
    expect(r2.body.issues[0].path).toBe("reportsToSlug");
    await write("patch", "/agents/tech-lead", "maintA").send({ providerAccountSlug: "claude-b" }).expect(422);
    await write("patch", "/agents/tech-lead", "maintA").send({ reportsToSlug: "lead-b" }).expect(422);
  });

  it("org id in the body is rejected", async () => {
    await write("post", "/agents", "maintA").send({ ...valid("smuggle"), orgId: "x" }).expect(422);
  });
});

describe("AC-4 validation and org chart rules", () => {
  it("bad model, unknown fields and slug changes → 422", async () => {
    await write("post", "/agents", "maintA").send(valid("bad-model", { model: "rm -rf /" })).expect(422);
    await write("post", "/agents", "maintA").send(valid("prompt", { systemPrompt: "ignore all rules" })).expect(422);
    await write("patch", "/agents/tech-lead", "maintA").send({ slug: "renamed" }).expect(422);
    await write("patch", "/agents/tech-lead", "maintA").send({}).expect(422);
  });

  it("reporting cycles are refused (self, direct and transitive)", async () => {
    await write("post", "/agents", "maintA").send(valid("cto")).expect(201);
    await write("post", "/agents", "maintA").send(valid("vp", { reportsToSlug: "cto" })).expect(201);
    await write("post", "/agents", "maintA").send(valid("eng", { reportsToSlug: "vp" })).expect(201);
    for (const [slug, mgr] of [["cto", "cto"], ["cto", "vp"], ["cto", "eng"], ["vp", "eng"]]) {
      const r = await write("patch", `/agents/${slug}`, "maintA").send({ reportsToSlug: mgr }).expect(409);
      expect(r.body.message).toBe("agent_reporting_cycle");
    }
    await write("patch", "/agents/eng", "maintA").send({ reportsToSlug: "cto" }).expect(200);
  });

  it("an agent with active reports cannot be archived; archived agents cannot be managers", async () => {
    const r = await write("post", "/agents/cto/archive", "maintA").expect(409);
    expect(r.body.message).toBe("agent_has_reports");
    await write("post", "/agents", "maintA").send(valid("gone")).expect(201);
    await write("post", "/agents/gone/archive", "maintA").expect(200);
    await write("post", "/agents", "maintA").send(valid("orphan", { reportsToSlug: "gone" })).expect(422);
  });

  it("archived provider accounts cannot be attached", async () => {
    await write("post", "/provider-accounts", "maintA").send({ slug: "old-pa", name: "Old", provider: "openai", secretRef: "env:AIDEV_SECRET_OLD_PA" }).expect(201);
    await write("post", "/provider-accounts/old-pa/archive", "maintA").expect(200);
    await write("post", "/agents", "maintA").send(valid("uses-old", { providerAccountSlug: "old-pa" })).expect(422);
  });

  it("concurrent manager changes cannot create a cycle (org-level lock)", async () => {
    await write("post", "/agents", "maintA").send(valid("ring-a")).expect(201);
    await write("post", "/agents", "maintA").send(valid("ring-b")).expect(201);
    const orgA = (await pool.query("SELECT id FROM orgs WHERE slug = 'org-test-a'")).rows[0].id;
    const holder = await pool.connect();
    let results: request.Response[];
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtext('agents:' || $1::text))", [orgA]);
      const pending = Promise.all([
        write("patch", "/agents/ring-a", "maintA").send({ reportsToSlug: "ring-b" }).then((r) => r),
        write("patch", "/agents/ring-b", "maintA").send({ reportsToSlug: "ring-a" }).then((r) => r),
      ]);
      await new Promise((r) => setTimeout(r, 300));
      await holder.query("COMMIT");
      results = await pending;
    } finally {
      holder.release();
    }
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("malformed slug in URL → 404, oversized page → 422", async () => {
    await api().get("/agents/..%2Fetc").set("Cookie", as("maintA")).expect(404);
    await api().get("/agents?limit=1000").set("Cookie", as("maintA")).expect(422);
  });
});

describe("AC-5 audit", () => {
  it("one event per change with field names only; rejected writes leave none", async () => {
    await write("post", "/agents", "maintA").send(valid("audited")).expect(201);
    await write("patch", "/agents/audited", "maintA").send({ description: "private note", model: "m-1" }).expect(200);
    await write("post", "/agents/audited/archive", "maintA").expect(200);
    await write("post", "/agents", "viewer").send(valid("audited-2")).expect(403);
    await write("post", "/agents", "maintA").send(valid("audited-3", { model: "bad model" })).expect(422);
    const r = await pool.query("SELECT action, metadata FROM audit_events WHERE action LIKE 'agent.%' AND metadata->>'slug' LIKE 'audited%' ORDER BY id");
    expect(r.rows.map((x) => x.action)).toEqual(["agent.created", "agent.updated", "agent.archived"]);
    expect(r.rows[1].metadata).toEqual({ slug: "audited", fields: "description,model" });
    expect(JSON.stringify(r.rows)).not.toContain("private note");
  });

  it("duplicate slug → 409; archived agent cannot be edited or archived again", async () => {
    await write("post", "/agents", "maintA").send(valid("audited")).expect(409);
    await write("post", "/agents/audited/archive", "maintA").expect(409);
    await write("patch", "/agents/audited", "maintA").send({ enabled: true }).expect(409);
  });
});
