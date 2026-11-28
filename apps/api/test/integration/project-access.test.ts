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
 * P2-13 Project-scoped access integration tests (AC-1..AC-7).
 * Users:
 *   900000001: org_admin (org-test-a)
 *   900000002: viewer (org-test-a)
 *   900000003: maintainer (org-test-a)
 *   900000004: org_admin (org-test-b)
 *   900000005: project_member (org-test-a)
 *   900000006: project_member (org-test-a)
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
const send = (method: "get" | "post" | "patch" | "delete", path: string, who: string) =>
  api()[method](path).set("Origin", ORIGIN).set("Cookie", as(who));

let projA1Id: string;
let projA2Id: string;
let projB1Id: string;
let taskA1Id: string;
let runA1Id: string;

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test$/.test(new URL(url).pathname.slice(1))) {
    throw new Error("TEST_DATABASE_URL with a *_test database is required");
  }
  pool = createPool(url, { max: 5 });
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrateUp(pool);
  await seed(pool, { NODE_ENV: "test" });

  for (const id of [900000003, 900000004, 900000005, 900000006]) {
    await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake') ON CONFLICT DO NOTHING", [id]);
  }

  await grantRole(pool, 900000001, "org-test-a", "org_admin");
  await grantRole(pool, 900000002, "org-test-a", "viewer");
  await grantRole(pool, 900000003, "org-test-a", "maintainer");
  await grantRole(pool, 900000004, "org-test-b", "org_admin");
  await grantRole(pool, 900000005, "org-test-a", "project_member");
  await grantRole(pool, 900000006, "org-test-a", "project_member");

  for (const [who, id] of [
    ["admin", 900000001],
    ["viewer", 900000002],
    ["maint", 900000003],
    ["adminB", 900000004],
    ["pm5", 900000005],
    ["pm6", 900000006],
  ] as const) {
    tokens[who] = await sessionFor(id);
  }

  app = await createApp({
    config: testConfig({ databaseUrl: url }),
    githubClient: noGithub,
    pool,
  });
  await app.init();

  // Create test projects in org-test-a
  const p1 = await send("post", "/projects", "admin").send({ slug: "proj-alpha", name: "Project Alpha" });
  expect(p1.status).toBe(201);
  const p2 = await send("post", "/projects", "admin").send({ slug: "proj-beta", name: "Project Beta" });
  expect(p2.status).toBe(201);

  const orgARow = (await pool.query<{ id: string }>("SELECT id FROM orgs WHERE slug = 'org-test-a'")).rows[0]!;
  const orgBRow = (await pool.query<{ id: string }>("SELECT id FROM orgs WHERE slug = 'org-test-b'")).rows[0]!;

  projA1Id = (await pool.query<{ id: string }>("SELECT id FROM projects WHERE slug = 'proj-alpha'")).rows[0]!.id;
  projA2Id = (await pool.query<{ id: string }>("SELECT id FROM projects WHERE slug = 'proj-beta'")).rows[0]!.id;

  // Create worker for dispatch
  await pool.query(
    "INSERT INTO workers (org_id, slug, name, type, workspace_path) VALUES ($1, 'mock-w', 'Mock W', 'mock', '/tmp/mock')",
    [orgARow.id],
  );

  // Create a project in org-test-b
  const pB = await send("post", "/projects", "adminB").send({ slug: "proj-gamma", name: "Project Gamma" });
  expect(pB.status).toBe(201);
  projB1Id = (await pool.query<{ id: string }>("SELECT id FROM projects WHERE slug = 'proj-gamma'")).rows[0]!.id;

  // Create a task and run in proj-alpha
  const t1 = await send("post", "/projects/proj-alpha/tasks", "admin").send({ title: "Task 1 in Alpha" });
  expect(t1.status).toBe(201);
  taskA1Id = (await pool.query<{ id: string }>("SELECT id FROM tasks WHERE project_id = $1 AND number = 1", [projA1Id])).rows[0]!.id;

  // Transition task to TODO so dispatch is possible
  await send("post", "/projects/proj-alpha/tasks/1/transitions", "admin").send({
    expectedFrom: "BACKLOG",
    to: "TODO",
  });

  const r1 = await send("post", "/projects/proj-alpha/tasks/1/dispatch", "admin").send({
    workerSlug: "mock-w",
  });
  expect(r1.status).toBe(201);
  runA1Id = r1.body.id;
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("AC-1: project_member without assignment", () => {
  it("GET /projects returns empty list", async () => {
    const res = await send("get", "/projects", "pm5");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it("GET /projects/:slug returns 404", async () => {
    const res = await send("get", "/projects/proj-alpha", "pm5");
    expect(res.status).toBe(404);
  });

  it("GET /projects/:slug/tasks returns 404", async () => {
    const res = await send("get", "/projects/proj-alpha/tasks", "pm5");
    expect(res.status).toBe(404);
  });

  it("GET /projects/:slug/tasks/:number returns 404", async () => {
    const res = await send("get", "/projects/proj-alpha/tasks/1", "pm5");
    expect(res.status).toBe(404);
  });

  it("POST /projects/:slug/tasks returns 404", async () => {
    const res = await send("post", "/projects/proj-alpha/tasks", "pm5").send({ title: "Unauthorized task" });
    expect(res.status).toBe(404);
  });

  it("GET /projects/:slug/tasks/:number/runs returns 404", async () => {
    const res = await send("get", "/projects/proj-alpha/tasks/1/runs", "pm5");
    expect(res.status).toBe(404);
  });

  it("GET /runs/:id returns 404", async () => {
    const res = await send("get", `/runs/${runA1Id}`, "pm5");
    expect(res.status).toBe(404);
  });

  it("POST /runs/:id/cancel returns 404", async () => {
    const res = await send("post", `/runs/${runA1Id}/cancel`, "pm5");
    expect(res.status).toBe(404);
  });

  it("POST /projects/:slug/tasks/:number/dispatch returns 404", async () => {
    const res = await send("post", "/projects/proj-alpha/tasks/1/dispatch", "pm5").send({ workerSlug: "mock-w" });
    expect(res.status).toBe(404);
  });
});

describe("AC-2: Assignment read", () => {
  beforeAll(async () => {
    // org_admin assigns pm5 to proj-alpha with access = 'read'
    const assignRes = await send("post", "/projects/proj-alpha/members", "admin").send({
      githubUserId: 900000005,
      access: "read",
    });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.changed).toBe(true);
  });

  it("GET /projects returns only assigned project", async () => {
    const res = await send("get", "/projects", "pm5");
    expect(res.status).toBe(200);
    expect(res.body.items.map((p: { slug: string }) => p.slug)).toEqual(["proj-alpha"]);
  });

  it("can view assigned project, tasks, and runs", async () => {
    const projRes = await send("get", "/projects/proj-alpha", "pm5");
    expect(projRes.status).toBe(200);
    expect(projRes.body.slug).toBe("proj-alpha");

    const tasksRes = await send("get", "/projects/proj-alpha/tasks", "pm5");
    expect(tasksRes.status).toBe(200);
    expect(tasksRes.body.items.length).toBeGreaterThan(0);

    const taskRes = await send("get", "/projects/proj-alpha/tasks/1", "pm5");
    expect(taskRes.status).toBe(200);
    expect(taskRes.body.number).toBe(1);

    const taskRunsRes = await send("get", "/projects/proj-alpha/tasks/1/runs", "pm5");
    expect(taskRunsRes.status).toBe(200);

    const runRes = await send("get", `/runs/${runA1Id}`, "pm5");
    expect(runRes.status).toBe(200);
    expect(runRes.body.id).toBe(runA1Id);
  });

  it("write operations on assigned read-only project return 403 Forbidden", async () => {
    const createRes = await send("post", "/projects/proj-alpha/tasks", "pm5").send({ title: "Attempt write" });
    expect(createRes.status).toBe(403);

    const patchRes = await send("patch", "/projects/proj-alpha/tasks/1", "pm5").send({ title: "Attempt rename" });
    expect(patchRes.status).toBe(403);

    const transRes = await send("post", "/projects/proj-alpha/tasks/1/transitions", "pm5").send({
      expectedFrom: "TODO",
      to: "IN_PROGRESS",
    });
    expect(transRes.status).toBe(403);

    const cancelRes = await send("post", `/runs/${runA1Id}/cancel`, "pm5");
    expect(cancelRes.status).toBe(403);
  });

  it("unassigned project (proj-beta) returns 404 for all operations", async () => {
    expect((await send("get", "/projects/proj-beta", "pm5")).status).toBe(404);
    expect((await send("get", "/projects/proj-beta/tasks", "pm5")).status).toBe(404);
    expect((await send("post", "/projects/proj-beta/tasks", "pm5").send({ title: "X" })).status).toBe(404);
  });
});

describe("AC-3: Assignment write", () => {
  beforeAll(async () => {
    // org_admin upgrades pm5 assignment to 'write'
    const upgradeRes = await send("post", "/projects/proj-alpha/members", "admin").send({
      githubUserId: 900000005,
      access: "write",
    });
    expect(upgradeRes.status).toBe(200);
    expect(upgradeRes.body.changed).toBe(true);
  });

  it("can create task, update task, transition status, and dispatch", async () => {
    // 1. Create task
    const createRes = await send("post", "/projects/proj-alpha/tasks", "pm5").send({
      title: "Created by pm5",
      description: "Description",
    });
    expect(createRes.status).toBe(201);
    const taskNumber = createRes.body.number;

    // 2. Update task
    const patchRes = await send("patch", `/projects/proj-alpha/tasks/${taskNumber}`, "pm5").send({
      title: "Updated by pm5",
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.title).toBe("Updated by pm5");

    // 3. Transition task
    const transRes = await send("post", `/projects/proj-alpha/tasks/${taskNumber}/transitions`, "pm5").send({
      expectedFrom: "BACKLOG",
      to: "TODO",
    });
    expect(transRes.status).toBe(200);
    expect(transRes.body.status).toBe("TODO");

    // Cancel previous running run first so worker is free
    await send("post", `/runs/${runA1Id}/cancel`, "admin");

    // 4. Dispatch run
    const dispatchRes = await send("post", `/projects/proj-alpha/tasks/${taskNumber}/dispatch`, "pm5").send({
      workerSlug: "mock-w",
    });
    expect(dispatchRes.status).toBe(201);
    const newRunId = dispatchRes.body.id;

    // 5. Cancel run
    const cancelRes = await send("post", `/runs/${newRunId}/cancel`, "pm5");
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe("CANCELLED");
  });

  it("still returns 404 for unassigned project", async () => {
    expect((await send("get", "/projects/proj-beta", "pm5")).status).toBe(404);
    expect((await send("post", "/projects/proj-beta/tasks", "pm5").send({ title: "X" })).status).toBe(404);
  });
});

describe("AC-4: Revoking assignment takes effect immediately", () => {
  it("removes access on the very next request", async () => {
    // Verify currently has access
    expect((await send("get", "/projects/proj-alpha", "pm5")).status).toBe(200);

    // Unassign pm5 from proj-alpha
    const delRes = await send("delete", "/projects/proj-alpha/members", "admin").send({
      githubUserId: 900000005,
    });
    expect(delRes.status).toBe(200);
    expect(delRes.body.changed).toBe(true);

    // Next request immediately 404
    expect((await send("get", "/projects/proj-alpha", "pm5")).status).toBe(404);
    expect((await send("get", "/projects", "pm5")).body.items).toEqual([]);
  });
});

describe("AC-5: Cross-org isolation", () => {
  it("cannot assign project to a user using an orgId in body (strict schema)", async () => {
    const res = await send("post", "/projects/proj-alpha/members", "admin").send({
      githubUserId: 900000006,
      access: "read",
      orgId: projB1Id,
    });
    expect(res.status).toBe(422);
  });

  it("cannot access or assign project belonging to another org", async () => {
    // admin in org-test-a cannot see proj-gamma from org-test-b
    const res = await send("post", "/projects/proj-gamma/members", "admin").send({
      githubUserId: 900000006,
      access: "read",
    });
    expect(res.status).toBe(404);
  });

  it("database constraint rejects cross-org project_assignments FK", async () => {
    const orgAId = (await pool.query<{ id: string }>("SELECT id FROM orgs WHERE slug = 'org-test-a'")).rows[0]!.id;
    const userRow = (await pool.query<{ id: string }>("SELECT id FROM users WHERE github_user_id = 900000005")).rows[0]!;

    // Try inserting assignment with orgA but project from orgB
    await expect(
      pool.query(
        "INSERT INTO project_assignments (org_id, project_id, user_id, access) VALUES ($1, $2, $3, 'read')",
        [orgAId, projB1Id, userRow.id],
      ),
    ).rejects.toThrow(/project_assignments_project_same_org_fk/);
  });

  it("assignment query strictly filters on org_id (no cross-org leakage)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const scopeCode = fs.readFileSync(path.join(__dirname, "../../src/rbac/project-scope.ts"), "utf8");
    expect(scopeCode).toMatch(/FROM\s+project_assignments\s+WHERE\s+org_id\s*=\s*\$1/);

    const controllerCode = fs.readFileSync(path.join(__dirname, "../../src/projects/projects.controller.ts"), "utf8");
    expect(controllerCode).toContain("pa.org_id = p.org_id");

    const orgBId = (await pool.query<{ id: string }>("SELECT id FROM orgs WHERE slug = 'org-test-b'")).rows[0]!.id;
    const userRow = (await pool.query<{ id: string }>("SELECT id FROM users WHERE github_user_id = 900000005")).rows[0]!;
    const r = await pool.query(
      "SELECT access FROM project_assignments WHERE org_id = $1 AND project_id = $2 AND user_id = $3",
      [orgBId, projA1Id, userRow.id],
    );
    expect(r.rows.length).toBe(0);
  });
});

describe("AC-6: Existing roles maintain full org-wide access", () => {
  it("org_admin can access any project without assignment", async () => {
    const res = await send("get", "/projects", "admin");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);

    expect((await send("get", "/projects/proj-alpha", "admin")).status).toBe(200);
    expect((await send("get", "/projects/proj-beta", "admin")).status).toBe(200);
  });

  it("maintainer can access any project without assignment", async () => {
    const res = await send("get", "/projects", "maint");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);

    expect((await send("get", "/projects/proj-alpha", "maint")).status).toBe(200);
    expect((await send("get", "/projects/proj-beta", "maint")).status).toBe(200);

    // Maintainer can write tasks
    const taskRes = await send("post", "/projects/proj-beta/tasks", "maint").send({
      title: "Maintainer task in Beta",
    });
    expect(taskRes.status).toBe(201);
  });

  it("viewer can read any project without assignment", async () => {
    const res = await send("get", "/projects", "viewer");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);

    expect((await send("get", "/projects/proj-alpha", "viewer")).status).toBe(200);
    expect((await send("get", "/projects/proj-beta", "viewer")).status).toBe(200);
  });
});

describe("AC-7: Audit events and member endpoints", () => {
  it("writes audit event project.member_assigned and project.member_unassigned exactly once", async () => {
    // 1. Assign pm6 to proj-beta
    const assignRes = await send("post", "/projects/proj-beta/members", "admin").send({
      githubUserId: 900000006,
      access: "read",
    });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.changed).toBe(true);

    const assignAudit = await pool.query<{ actor_github_user_id: string; target_id: string; metadata: any }>(
      "SELECT actor_github_user_id, target_id, metadata FROM audit_events WHERE action = 'project.member_assigned' ORDER BY id DESC LIMIT 1",
    );
    expect(assignAudit.rows.length).toBe(1);
    expect(Number(assignAudit.rows[0]!.actor_github_user_id)).toBe(900000001);
    expect(assignAudit.rows[0]!.target_id).toBe(projA2Id);
    expect(assignAudit.rows[0]!.metadata.githubUserId).toBe("900000006");
    expect(assignAudit.rows[0]!.metadata.access).toBe("read");

    // 2. Re-assigning with same access returns changed: false and writes NO new audit
    const countBefore = (await pool.query("SELECT count(*) FROM audit_events WHERE action = 'project.member_assigned'")).rows[0].count;
    const reassignRes = await send("post", "/projects/proj-beta/members", "admin").send({
      githubUserId: 900000006,
      access: "read",
    });
    expect(reassignRes.status).toBe(200);
    expect(reassignRes.body.changed).toBe(false);
    const countAfter = (await pool.query("SELECT count(*) FROM audit_events WHERE action = 'project.member_assigned'")).rows[0].count;
    expect(countAfter).toBe(countBefore);

    // 3. List members of proj-beta
    const listRes = await send("get", "/projects/proj-beta/members", "admin");
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].githubUserId).toBe(900000006);
    expect(listRes.body[0].access).toBe("read");

    // 4. Unassign pm6
    const unassignRes = await send("delete", "/projects/proj-beta/members", "admin").send({
      githubUserId: 900000006,
    });
    expect(unassignRes.status).toBe(200);
    expect(unassignRes.body.changed).toBe(true);

    const unassignAudit = await pool.query<{ actor_github_user_id: string; target_id: string; metadata: any }>(
      "SELECT actor_github_user_id, target_id, metadata FROM audit_events WHERE action = 'project.member_unassigned' ORDER BY id DESC LIMIT 1",
    );
    expect(unassignAudit.rows.length).toBe(1);
    expect(Number(unassignAudit.rows[0]!.actor_github_user_id)).toBe(900000001);
    expect(unassignAudit.rows[0]!.target_id).toBe(projA2Id);
    expect(unassignAudit.rows[0]!.metadata.githubUserId).toBe("900000006");

    // 5. Re-unassigning returns changed: false and writes NO audit
    const unassignCountBefore = (await pool.query("SELECT count(*) FROM audit_events WHERE action = 'project.member_unassigned'")).rows[0].count;
    const reunassignRes = await send("delete", "/projects/proj-beta/members", "admin").send({
      githubUserId: 900000006,
    });
    expect(reunassignRes.status).toBe(200);
    expect(reunassignRes.body.changed).toBe(false);
    const unassignCountAfter = (await pool.query("SELECT count(*) FROM audit_events WHERE action = 'project.member_unassigned'")).rows[0].count;
    expect(unassignCountAfter).toBe(unassignCountBefore);
  });

  it("cannot assign user who does not have project_member role in org", async () => {
    // User 900000002 has role viewer, not project_member
    const res = await send("post", "/projects/proj-beta/members", "admin").send({
      githubUserId: 900000002,
      access: "read",
    });
    expect(res.status).toBe(422);
    expect(res.body.message).toBe("user_not_project_member");
  });

  it("non-admin cannot assign or unassign project members", async () => {
    expect((await send("post", "/projects/proj-beta/members", "maint").send({ githubUserId: 900000006, access: "read" })).status).toBe(403);
    expect((await send("post", "/projects/proj-beta/members", "viewer").send({ githubUserId: 900000006, access: "read" })).status).toBe(403);
    expect((await send("post", "/projects/proj-beta/members", "pm5").send({ githubUserId: 900000006, access: "read" })).status).toBe(403);
  });
});
