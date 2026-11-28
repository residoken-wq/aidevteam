import type { INestApplication } from "@nestjs/common";
import { createPool, grantRole, migrateUp, seed, type Pool } from "@aidevteam/db";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GithubOAuthClient } from "../../src/auth/github-client";
import { createApp } from "../../src/bootstrap";
import { SESSION_COOKIE } from "../../src/cookies";
import { testConfig } from "../helpers";

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

let orgAId: string;
let orgBId: string;
let userPmAId: string;
let projA1Id: string;
let projA2Id: string;
let projB1Id: string;
let agent1Id: string;
let agent2Id: string;

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

  const testIds = [
    900000001, // admin_a (org_admin, org-test-a)
    900000002, // viewer_a (viewer, org-test-a)
    900000003, // maintainer_a (maintainer, org-test-a)
    900000004, // admin_b (org_admin, org-test-b)
    900000005, // pm_assigned (project_member, org-test-a)
    900000006, // pm_unassigned (project_member, org-test-a, no assignments)
  ];

  for (const id of testIds) {
    await pool.query(
      "INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'test') ON CONFLICT DO NOTHING",
      [id],
    );
    await pool.query(
      "INSERT INTO users (github_user_id, github_login) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [id, `user-${id}`],
    );
  }

  await grantRole(pool, 900000001, "org-test-a", "org_admin");
  await grantRole(pool, 900000002, "org-test-a", "viewer");
  await grantRole(pool, 900000003, "org-test-a", "maintainer");
  await grantRole(pool, 900000004, "org-test-b", "org_admin");
  await grantRole(pool, 900000005, "org-test-a", "project_member");
  await grantRole(pool, 900000006, "org-test-a", "project_member");

  tokens.admin_a = await sessionFor(900000001);
  tokens.viewer_a = await sessionFor(900000002);
  tokens.maintainer_a = await sessionFor(900000003);
  tokens.admin_b = await sessionFor(900000004);
  tokens.pm_assigned = await sessionFor(900000005);
  tokens.pm_unassigned = await sessionFor(900000006);

  const orgA = await pool.query<{ id: string }>("SELECT id FROM orgs WHERE slug = 'org-test-a'");
  orgAId = orgA.rows[0]!.id;
  const orgB = await pool.query<{ id: string }>("SELECT id FROM orgs WHERE slug = 'org-test-b'");
  orgBId = orgB.rows[0]!.id;

  const uPmA = await pool.query<{ id: string }>("SELECT id FROM users WHERE github_user_id = 900000005");
  userPmAId = uPmA.rows[0]!.id;

  // Create Project A1 and A2 in Org A
  const pA1 = await pool.query<{ id: string }>(
    "INSERT INTO projects (org_id, slug, name) VALUES ($1, 'proj-a1', 'Project A1') RETURNING id",
    [orgAId],
  );
  projA1Id = pA1.rows[0]!.id;

  const pA2 = await pool.query<{ id: string }>(
    "INSERT INTO projects (org_id, slug, name) VALUES ($1, 'proj-a2', 'Project A2') RETURNING id",
    [orgAId],
  );
  projA2Id = pA2.rows[0]!.id;

  // Create Project B1 in Org B
  const pB1 = await pool.query<{ id: string }>(
    "INSERT INTO projects (org_id, slug, name) VALUES ($1, 'proj-b1', 'Project B1') RETURNING id",
    [orgBId],
  );
  projB1Id = pB1.rows[0]!.id;

  // Assign user 900000005 to Project A1 ONLY
  await pool.query(
    "INSERT INTO project_assignments (org_id, project_id, user_id, access) VALUES ($1, $2, $3, 'read')",
    [orgAId, projA1Id, userPmAId],
  );

  // Create provider account & agents in Org A
  const pa = await pool.query<{ id: string }>(
    "INSERT INTO provider_accounts (org_id, slug, name, provider, license_status, secret_ref) VALUES ($1, 'pa-a', 'PA A', 'anthropic', 'approved', 'env:AIDEV_SECRET_CLAUDE_A') RETURNING id",
    [orgAId],
  );
  const a1 = await pool.query<{ id: string }>(
    "INSERT INTO agents (org_id, provider_account_id, slug, name, title) VALUES ($1, $2, 'agent-lead', 'Lead Agent', 'lead') RETURNING id",
    [orgAId, pa.rows[0]!.id],
  );
  agent1Id = a1.rows[0]!.id;

  const a2 = await pool.query<{ id: string }>(
    "INSERT INTO agents (org_id, provider_account_id, slug, name, title) VALUES ($1, $2, 'agent-worker', 'Worker Agent', 'worker') RETURNING id",
    [orgAId, pa.rows[0]!.id],
  );
  agent2Id = a2.rows[0]!.id;

  // Seed tasks in Project A1 (must start in BACKLOG, then transition):
  // Task 1: "Fix % error in discount" (priority high, agent-lead, status BACKLOG)
  // Task 2: "Fix 50 percent error in discount" (priority low, agent-worker, status TODO)
  // Task 3: "Update _private method" (priority medium, agent null, status IN_PROGRESS)
  // Task 4: "Update private method" (priority high, agent null, status DONE)
  await pool.query(
    `INSERT INTO tasks (org_id, project_id, number, title, priority, agent_id, status)
     VALUES ($1, $2, 1, 'Fix % error in discount', 'high', $3, 'BACKLOG'),
            ($1, $2, 2, 'Fix 50 percent error in discount', 'low', $4, 'BACKLOG'),
            ($1, $2, 3, 'Update _private method', 'medium', NULL, 'BACKLOG'),
            ($1, $2, 4, 'Update private method', 'high', NULL, 'BACKLOG')`,
    [orgAId, projA1Id, agent1Id, agent2Id],
  );

  // Transition Task 2 to TODO
  await pool.query("UPDATE tasks SET status = 'TODO' WHERE project_id = $1 AND number = 2", [projA1Id]);

  // Transition Task 3: BACKLOG -> TODO -> IN_PROGRESS
  await pool.query("UPDATE tasks SET status = 'TODO' WHERE project_id = $1 AND number = 3", [projA1Id]);
  await pool.query("UPDATE tasks SET status = 'IN_PROGRESS' WHERE project_id = $1 AND number = 3", [projA1Id]);

  // Transition Task 4: BACKLOG -> TODO -> IN_PROGRESS -> IN_REVIEW -> DONE
  await pool.query("UPDATE tasks SET status = 'TODO' WHERE project_id = $1 AND number = 4", [projA1Id]);
  await pool.query("UPDATE tasks SET status = 'IN_PROGRESS' WHERE project_id = $1 AND number = 4", [projA1Id]);
  await pool.query("UPDATE tasks SET status = 'IN_REVIEW' WHERE project_id = $1 AND number = 4", [projA1Id]);
  await pool.query("UPDATE tasks SET status = 'DONE' WHERE project_id = $1 AND number = 4", [projA1Id]);

  // Seed tasks in Project A2:
  // Task 1: "Setup auth pipeline" (priority medium, agent-lead, status TODO)
  // Task 2: "Setup deploy pipeline" (priority low, agent null, status CANCELLED, cancel_reason = 'not needed')
  await pool.query(
    `INSERT INTO tasks (org_id, project_id, number, title, priority, agent_id, status)
     VALUES ($1, $2, 1, 'Setup auth pipeline', 'medium', $3, 'BACKLOG'),
            ($1, $2, 2, 'Setup deploy pipeline', 'low', NULL, 'BACKLOG')`,
    [orgAId, projA2Id, agent1Id],
  );

  await pool.query("UPDATE tasks SET status = 'TODO' WHERE project_id = $1 AND number = 1", [projA2Id]);
  await pool.query(
    "UPDATE tasks SET status = 'CANCELLED', cancel_reason = 'not needed' WHERE project_id = $1 AND number = 2",
    [projA2Id],
  );

  // Seed task in Project B1 (Org B):
  // Task 1: "Fix % error in discount" in Org B (same title to test cross-org isolation)
  await pool.query(
    `INSERT INTO tasks (org_id, project_id, number, title, priority, status)
     VALUES ($1, $2, 1, 'Fix % error in discount', 'high', 'BACKLOG')`,
    [orgBId, projB1Id],
  );

  app = await createApp({
    config: testConfig(),
    pool,
    githubClient: noGithub,
  });
  await app.init();
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
});

describe("P3-08 AC-1: Filter criteria, literal %, _, pagination and total", () => {
  it("filters with q containing literal % and matches only exact %", async () => {
    const res = await send("get", "/tasks/search?q=%25", "admin_a");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe("Fix % error in discount");
    expect(res.body.items[0].projectSlug).toBe("proj-a1");
  });

  it("filters with q containing literal _ and matches only exact _", async () => {
    const res = await send("get", "/tasks/search?q=_private", "admin_a");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe("Update _private method");
  });

  it("filters by project slug", async () => {
    const res = await send("get", "/tasks/search?project=proj-a2", "admin_a");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.every((i: { projectSlug: string }) => i.projectSlug === "proj-a2")).toBe(true);
  });

  it("filters by agent slug and agent=none", async () => {
    const resAgent = await send("get", "/tasks/search?agent=agent-lead", "admin_a");
    expect(resAgent.status).toBe(200);
    expect(resAgent.body.total).toBe(2);
    expect(resAgent.body.items.every((i: { agentSlug: string }) => i.agentSlug === "agent-lead")).toBe(true);

    const resNone = await send("get", "/tasks/search?agent=none", "admin_a");
    expect(resNone.status).toBe(200);
    expect(resNone.body.total).toBe(3);
    expect(resNone.body.items.every((i: { agentSlug: string | null }) => i.agentSlug === null)).toBe(true);
  });

  it("filters by status (single, comma-separated, repeated) and priority", async () => {
    // Single status
    const r1 = await send("get", "/tasks/search?status=BACKLOG", "admin_a");
    expect(r1.status).toBe(200);
    expect(r1.body.total).toBe(1);

    // Comma-separated status
    const r2 = await send("get", "/tasks/search?status=BACKLOG,TODO", "admin_a");
    expect(r2.status).toBe(200);
    expect(r2.body.total).toBe(3);

    // Repeated status
    const r3 = await send("get", "/tasks/search?status=BACKLOG&status=TODO", "admin_a");
    expect(r3.status).toBe(200);
    expect(r3.body.total).toBe(3);

    // Filter by priority
    const rPri = await send("get", "/tasks/search?priority=high", "admin_a");
    expect(rPri.status).toBe(200);
    expect(rPri.body.total).toBe(2);
    expect(rPri.body.items.every((i: { priority: string }) => i.priority === "high")).toBe(true);
  });

  it("combines multiple filters correctly", async () => {
    const res = await send("get", "/tasks/search?project=proj-a1&priority=high&status=BACKLOG", "admin_a");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].number).toBe(1);
  });

  it("paginates without duplicate or missing items", async () => {
    const page1 = await send("get", "/tasks/search?limit=2&offset=0", "admin_a");
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.total).toBe(6);

    const page2 = await send("get", "/tasks/search?limit=2&offset=2", "admin_a");
    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.total).toBe(6);

    const ids1 = page1.body.items.map((i: { projectSlug: string; number: number }) => `${i.projectSlug}:${i.number}`);
    const ids2 = page2.body.items.map((i: { projectSlug: string; number: number }) => `${i.projectSlug}:${i.number}`);
    for (const id of ids1) {
      expect(ids2).not.toContain(id);
    }
  });
});

describe("P3-08 AC-2: Cross-org isolation", () => {
  it("never returns tasks from another organization", async () => {
    // Org A has 6 tasks, Org B has 1 task.
    // Querying all tasks in Org A returns exactly 6 tasks, none from Org B.
    const resA = await send("get", "/tasks/search?limit=100", "admin_a");
    expect(resA.status).toBe(200);
    expect(resA.body.total).toBe(6);
    expect(resA.body.items.every((i: { projectSlug: string }) => i.projectSlug !== "proj-b1")).toBe(true);

    // Querying in Org B returns 1 task
    const resB = await send("get", "/tasks/search?limit=100", "admin_b");
    expect(resB.status).toBe(200);
    expect(resB.body.total).toBe(1);
    expect(resB.body.items[0].projectSlug).toBe("proj-b1");
  });
});

describe("P3-08 AC-3: RBAC / project-scope for project_member and viewer", () => {
  it("viewer sees all unarchived projects of the org", async () => {
    const res = await send("get", "/tasks/search?limit=100", "viewer_a");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(6);
  });

  it("project_member sees only tasks from assigned projects", async () => {
    // pm_assigned is assigned only to proj-a1
    const res = await send("get", "/tasks/search?limit=100", "pm_assigned");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.items.every((i: { projectSlug: string }) => i.projectSlug === "proj-a1")).toBe(true);
  });

  it("project_member with no assignment sees empty list", async () => {
    const res = await send("get", "/tasks/search", "pm_unassigned");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toHaveLength(0);
  });

  it("project_member querying unassigned project returns empty list without 403 or 404", async () => {
    const res = await send("get", "/tasks/search?project=proj-a2", "pm_assigned");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toHaveLength(0);
  });
});

describe("P3-08 AC-4: Stats by project with status breakdown", () => {
  it("returns status breakdown per project for org_admin and viewer", async () => {
    const res = await send("get", "/projects/stats", "admin_a");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);

    const a1 = res.body.items.find((i: { projectSlug: string }) => i.projectSlug === "proj-a1");
    expect(a1).toBeDefined();
    expect(a1.counts).toEqual({
      BACKLOG: 1,
      TODO: 1,
      IN_PROGRESS: 1,
      IN_REVIEW: 0,
      DONE: 1,
      CANCELLED: 0,
    });
    expect(a1.total).toBe(4);

    const a2 = res.body.items.find((i: { projectSlug: string }) => i.projectSlug === "proj-a2");
    expect(a2).toBeDefined();
    expect(a2.counts).toEqual({
      BACKLOG: 0,
      TODO: 1,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 0,
      CANCELLED: 1,
    });
    expect(a2.total).toBe(2);
  });

  it("project_member sees stats only for assigned projects", async () => {
    const res = await send("get", "/projects/stats", "pm_assigned");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].projectSlug).toBe("proj-a1");
    expect(res.body.items[0].total).toBe(4);
  });

  it("project_member with no assignments sees empty stats list", async () => {
    const res = await send("get", "/projects/stats", "pm_unassigned");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });
});

describe("P3-08 AC-5: Query validation rejects invalid input with 422", () => {
  it("rejects unknown status", async () => {
    const res = await send("get", "/tasks/search?status=FOOBAR", "admin_a");
    expect(res.status).toBe(422);
    expect(res.body.message).toBe("validation_failed");
  });

  it("rejects limit > 100", async () => {
    const res = await send("get", "/tasks/search?limit=101", "admin_a");
    expect(res.status).toBe(422);
    expect(res.body.message).toBe("validation_failed");
  });

  it("rejects unknown query fields", async () => {
    const res = await send("get", "/tasks/search?unexpected=1", "admin_a");
    expect(res.status).toBe(422);
    expect(res.body.message).toBe("validation_failed");
  });

  it("rejects unknown fields on stats", async () => {
    const res = await send("get", "/projects/stats?unexpected=1", "admin_a");
    expect(res.status).toBe(422);
    expect(res.body.message).toBe("validation_failed");
  });
});
