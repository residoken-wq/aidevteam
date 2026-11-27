import type { INestApplication } from "@nestjs/common";
import { createPool, grantRole, migrateUp, seed, type Pool } from "@aidevteam/db";
import { RUN_STATUSES, TASK_STATUSES, type RunStatus, type TaskStatus } from "@aidevteam/contracts";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GithubOAuthClient } from "../../src/auth/github-client";
import { createApp } from "../../src/bootstrap";
import { SESSION_COOKIE } from "../../src/cookies";
import { testConfig } from "../helpers";

const noGithub: GithubOAuthClient = {
  exchangeCodeForIdentity: async () => {
    throw new Error("not used");
  },
};

let pool: Pool;
let app: INestApplication;
const tokens: Record<string, string> = {};

let orgAId: string;
let orgBId: string;
let orgEmptyId: string;
let userAId: string;
let userBId: string;

async function advanceTask(taskId: string, targetStatus: TaskStatus): Promise<void> {
  if (targetStatus === "BACKLOG") return;
  if (targetStatus === "CANCELLED") {
    await pool.query("UPDATE tasks SET status = 'CANCELLED', cancel_reason = 'cancelled in test' WHERE id = $1", [taskId]);
    return;
  }
  await pool.query("UPDATE tasks SET status = 'TODO' WHERE id = $1", [taskId]);
  if (targetStatus === "TODO") return;
  await pool.query("UPDATE tasks SET status = 'IN_PROGRESS' WHERE id = $1", [taskId]);
  if (targetStatus === "IN_PROGRESS") return;
  await pool.query("UPDATE tasks SET status = 'IN_REVIEW' WHERE id = $1", [taskId]);
  if (targetStatus === "IN_REVIEW") return;
  if (targetStatus === "DONE") {
    await pool.query("UPDATE tasks SET status = 'DONE' WHERE id = $1", [taskId]);
  }
}

async function advanceRun(runId: string, targetStatus: RunStatus, finishedHoursAgo?: number): Promise<void> {
  if (targetStatus === "QUEUED") return;
  if (targetStatus === "CANCELLED") {
    await pool.query(
      `UPDATE agent_runs
          SET status = 'CANCELLED',
              finished_at = CASE WHEN $2::int IS NOT NULL THEN now() - interval '1 hour' * $2 ELSE NULL END
        WHERE id = $1`,
      [runId, finishedHoursAgo ?? null],
    );
    return;
  }
  await pool.query("UPDATE agent_runs SET status = 'RUNNING', started_at = now() - interval '1 hour' * 1 WHERE id = $1", [runId]);
  if (targetStatus === "RUNNING") return;
  await pool.query(
    `UPDATE agent_runs
        SET status = $2,
            finished_at = CASE WHEN $3::int IS NOT NULL THEN now() - interval '1 hour' * $3 ELSE NULL END
      WHERE id = $1`,
    [runId, targetStatus, finishedHoursAgo ?? null],
  );
}

async function sessionFor(githubUserId: number, activeOrgSlug?: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  let activeOrgId: string | null = null;
  if (activeOrgSlug) {
    const r = await pool.query<{ id: string }>("SELECT id FROM orgs WHERE slug = $1", [activeOrgSlug]);
    activeOrgId = r.rows[0]?.id ?? null;
  }
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, active_org_id)
     SELECT id, $2, now() + interval '1 hour', $3 FROM users WHERE github_user_id = $1`,
    [githubUserId, createHash("sha256").update(token).digest(), activeOrgId],
  );
  return token;
}

const as = (who: string) => `${SESSION_COOKIE}=${tokens[who]}`;
const api = () => request(app.getHttpServer());

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test$/.test(new URL(url).pathname.slice(1))) {
    throw new Error("TEST_DATABASE_URL with a *_test database is required");
  }
  pool = createPool(url, { max: 10 });
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrateUp(pool);
  await seed(pool, { NODE_ENV: "test" });

  // Add fake users to allowlist and users table
  for (const id of [900000003, 900000004, 900000005, 900000006]) {
    await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake')", [id]);
    await pool.query("INSERT INTO users (github_user_id, github_login) VALUES ($1, $2)", [id, `test-user-${id}`]);
  }

  // Create an empty org
  const emptyOrgRes = await pool.query<{ id: string }>(
    "INSERT INTO orgs (slug, name) VALUES ('org-empty', 'Org Empty') RETURNING id",
  );
  orgEmptyId = emptyOrgRes.rows[0]!.id;

  // Insert default roles for org-empty
  for (const roleKey of ["org_admin", "maintainer", "viewer"]) {
    await pool.query("INSERT INTO roles (org_id, key, name) VALUES ($1, $2, $2)", [orgEmptyId, roleKey]);
  }

  const orgARes = await pool.query<{ id: string }>("SELECT id FROM orgs WHERE slug = 'org-test-a'");
  orgAId = orgARes.rows[0]!.id;

  const orgBRes = await pool.query<{ id: string }>("SELECT id FROM orgs WHERE slug = 'org-test-b'");
  orgBId = orgBRes.rows[0]!.id;

  const userARes = await pool.query<{ id: string }>("SELECT id FROM users WHERE github_user_id = 900000003");
  userAId = userARes.rows[0]!.id;

  const userBRes = await pool.query<{ id: string }>("SELECT id FROM users WHERE github_user_id = 900000004");
  userBId = userBRes.rows[0]!.id;

  // Grant roles:
  // 900000002 -> viewer org-test-a
  // 900000003 -> maintainer org-test-a
  // 900000004 -> maintainer org-test-b
  // 900000006 -> viewer org-empty
  // 900000005 -> no role anywhere
  await grantRole(pool, 900000002, "org-test-a", "viewer");
  await grantRole(pool, 900000003, "org-test-a", "maintainer");
  await grantRole(pool, 900000004, "org-test-b", "maintainer");
  await grantRole(pool, 900000006, "org-empty", "viewer");

  tokens.viewerA = await sessionFor(900000002, "org-test-a");
  tokens.maintA = await sessionFor(900000003, "org-test-a");
  tokens.maintB = await sessionFor(900000004, "org-test-b");
  tokens.viewerEmpty = await sessionFor(900000006, "org-empty");
  tokens.noRole = await sessionFor(900000005);

  app = await createApp({
    config: testConfig(),
    pool,
    githubClient: noGithub,
  });
  await app.init();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("AC-3 Org rỗng", () => {
  it("returns 200, all counts = 0, recentRuns = [] for empty org", async () => {
    const res = await api()
      .get("/dashboard")
      .set("Cookie", as("viewerEmpty"))
      .expect(200);

    expect(res.body).toEqual({
      projects: { active: 0 },
      agents: { enabled: 0, disabled: 0 },
      workers: { enabled: 0, disabled: 0 },
      tasks: {
        BACKLOG: 0,
        TODO: 0,
        IN_PROGRESS: 0,
        IN_REVIEW: 0,
        DONE: 0,
        CANCELLED: 0,
      },
      runs7d: {
        QUEUED: 0,
        RUNNING: 0,
        SUCCEEDED: 0,
        FAILED: 0,
        CANCELLED: 0,
        INTERRUPTED: 0,
      },
      recentRuns: [],
    });
  });
});

describe("AC-4 RBAC and Authentication", () => {
  it("viewer gets 200", async () => {
    await api()
      .get("/dashboard")
      .set("Cookie", as("viewerA"))
      .expect(200);
  });

  it("logged in user with no role gets 403", async () => {
    await api()
      .get("/dashboard")
      .set("Cookie", as("noRole"))
      .expect(403);
  });

  it("unauthenticated request gets 401", async () => {
    await api()
      .get("/dashboard")
      .expect(401);
  });
});

describe("AC-1 Seed dữ liệu giả and independent COUNT verification", () => {
  it("all counts match independent DB counts and recentRuns reflects 5 newest runs", async () => {
    // 1. Projects in org-test-a: 2 active, 1 archived
    const p1 = await pool.query<{ id: string }>(
      "INSERT INTO projects (org_id, slug, name, created_by_user_id) VALUES ($1, 'proj-active-1', 'Active 1', $2) RETURNING id",
      [orgAId, userAId],
    );
    const p2 = await pool.query<{ id: string }>(
      "INSERT INTO projects (org_id, slug, name, created_by_user_id) VALUES ($1, 'proj-active-2', 'Active 2', $2) RETURNING id",
      [orgAId, userAId],
    );
    await pool.query(
      "INSERT INTO projects (org_id, slug, name, archived_at, created_by_user_id) VALUES ($1, 'proj-archived-1', 'Archived 1', now(), $2)",
      [orgAId, userAId],
    );

    // 2. Agents in org-test-a: 2 enabled, 1 disabled, 1 archived
    await pool.query(
      "INSERT INTO agents (org_id, slug, name, enabled, created_by_user_id) VALUES ($1, 'agent-en-1', 'Agent En 1', true, $2)",
      [orgAId, userAId],
    );
    await pool.query(
      "INSERT INTO agents (org_id, slug, name, enabled, created_by_user_id) VALUES ($1, 'agent-en-2', 'Agent En 2', true, $2)",
      [orgAId, userAId],
    );
    await pool.query(
      "INSERT INTO agents (org_id, slug, name, enabled, created_by_user_id) VALUES ($1, 'agent-dis-1', 'Agent Dis 1', false, $2)",
      [orgAId, userAId],
    );
    await pool.query(
      "INSERT INTO agents (org_id, slug, name, enabled, archived_at, created_by_user_id) VALUES ($1, 'agent-archived', 'Agent Arc', true, now(), $2)",
      [orgAId, userAId],
    );

    // 3. Workers in org-test-a: 2 enabled, 1 disabled, 1 archived
    const w1 = await pool.query<{ id: string }>(
      "INSERT INTO workers (org_id, slug, name, type, workspace_path, enabled, created_by_user_id) VALUES ($1, 'worker-en-1', 'Worker 1', 'mock', '/srv/w/1', true, $2) RETURNING id",
      [orgAId, userAId],
    );
    await pool.query(
      "INSERT INTO workers (org_id, slug, name, type, workspace_path, enabled, created_by_user_id) VALUES ($1, 'worker-en-2', 'Worker 2', 'mock', '/srv/w/2', true, $2)",
      [orgAId, userAId],
    );
    await pool.query(
      "INSERT INTO workers (org_id, slug, name, type, workspace_path, enabled, created_by_user_id) VALUES ($1, 'worker-dis-1', 'Worker 3', 'mock', '/srv/w/3', false, $2)",
      [orgAId, userAId],
    );
    await pool.query(
      "INSERT INTO workers (org_id, slug, name, type, workspace_path, enabled, archived_at, created_by_user_id) VALUES ($1, 'worker-arc', 'Worker Arc', 'mock', '/srv/w/4', true, now(), $2)",
      [orgAId, userAId],
    );

    // 4. Tasks across all statuses in org-test-a
    // TASK_STATUSES: ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]
    const taskIds: Record<string, string> = {};
    let taskNum = 1;
    for (const st of TASK_STATUSES) {
      const tRes = await pool.query<{ id: string }>(
        "INSERT INTO tasks (org_id, project_id, number, title, status, created_by_user_id) VALUES ($1, $2, $3, $4, 'BACKLOG', $5) RETURNING id",
        [orgAId, p1.rows[0]!.id, taskNum++, `Task for ${st}`, userAId],
      );
      await advanceTask(tRes.rows[0]!.id, st);
      taskIds[st] = tRes.rows[0]!.id;
    }
    // Extra task in BACKLOG under p2
    const extraTask = await pool.query<{ id: string }>(
      "INSERT INTO tasks (org_id, project_id, number, title, status, created_by_user_id) VALUES ($1, $2, $3, 'Extra Backlog', 'BACKLOG', $4) RETURNING id",
      [orgAId, p2.rows[0]!.id, 1, userAId],
    );

    // 5. Runs: in 7d and outside 7d
    // RUN_STATUSES: ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED"]
    // Within 7 days:
    const runWithin7d: Array<{ id: string; status: RunStatus; queuedAt: string; finishedAt: string | null }> = [];
    const runSpecs: Array<{ status: RunStatus; hoursAgo: number; finished: boolean }> = [
      { status: "QUEUED", hoursAgo: 1, finished: false },
      { status: "RUNNING", hoursAgo: 2, finished: false },
      { status: "SUCCEEDED", hoursAgo: 5, finished: true },
      { status: "SUCCEEDED", hoursAgo: 12, finished: true },
      { status: "FAILED", hoursAgo: 24, finished: true },
      { status: "CANCELLED", hoursAgo: 48, finished: true },
      { status: "INTERRUPTED", hoursAgo: 72, finished: true },
    ];

    for (const spec of runSpecs) {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO agent_runs (org_id, task_id, worker_id, status, queued_at, created_by_user_id)
         VALUES ($1, $2, $3, 'QUEUED', now() - interval '1 hour' * $4, $5)
         RETURNING id`,
        [orgAId, taskIds[spec.status] ?? extraTask.rows[0]!.id, w1.rows[0]!.id, spec.hoursAgo, userAId],
      );
      await advanceRun(r.rows[0]!.id, spec.status, spec.finished ? spec.hoursAgo - 1 : undefined);
      runWithin7d.push({
        id: r.rows[0]!.id,
        status: spec.status,
        queuedAt: `hoursAgo:${spec.hoursAgo}`,
        finishedAt: spec.finished ? "finished" : null,
      });
    }

    // Runs outside 7 days (e.g. 8 days and 10 days ago):
    const rOld1 = await pool.query<{ id: string }>(
      `INSERT INTO agent_runs (org_id, task_id, worker_id, status, queued_at, created_by_user_id)
       VALUES ($1, $2, $3, 'QUEUED', now() - interval '8 days', $4) RETURNING id`,
      [orgAId, taskIds.DONE!, w1.rows[0]!.id, userAId],
    );
    await advanceRun(rOld1.rows[0]!.id, "SUCCEEDED", 8 * 24);

    const rOld2 = await pool.query<{ id: string }>(
      `INSERT INTO agent_runs (org_id, task_id, worker_id, status, queued_at, created_by_user_id)
       VALUES ($1, $2, $3, 'QUEUED', now() - interval '10 days', $4) RETURNING id`,
      [orgAId, taskIds.CANCELLED!, w1.rows[0]!.id, userAId],
    );
    await advanceRun(rOld2.rows[0]!.id, "FAILED", 10 * 24);

    // Call GET /dashboard
    const res = await api()
      .get("/dashboard")
      .set("Cookie", as("maintA"))
      .expect(200);

    // Independent COUNT queries
    const activeProjectsCount = (
      await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM projects WHERE org_id = $1 AND archived_at IS NULL", [orgAId])
    ).rows[0]!.count;
    expect(res.body.projects.active).toBe(activeProjectsCount);
    expect(res.body.projects.active).toBe(2);

    const enabledAgentsCount = (
      await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM agents WHERE org_id = $1 AND enabled = true AND archived_at IS NULL", [orgAId])
    ).rows[0]!.count;
    const disabledAgentsCount = (
      await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM agents WHERE org_id = $1 AND enabled = false AND archived_at IS NULL", [orgAId])
    ).rows[0]!.count;
    expect(res.body.agents.enabled).toBe(enabledAgentsCount);
    expect(res.body.agents.disabled).toBe(disabledAgentsCount);
    expect(res.body.agents).toEqual({ enabled: 2, disabled: 1 });

    const enabledWorkersCount = (
      await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM workers WHERE org_id = $1 AND enabled = true AND archived_at IS NULL", [orgAId])
    ).rows[0]!.count;
    const disabledWorkersCount = (
      await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM workers WHERE org_id = $1 AND enabled = false AND archived_at IS NULL", [orgAId])
    ).rows[0]!.count;
    expect(res.body.workers.enabled).toBe(enabledWorkersCount);
    expect(res.body.workers.disabled).toBe(disabledWorkersCount);
    expect(res.body.workers).toEqual({ enabled: 2, disabled: 1 });

    // Tasks counts
    for (const st of TASK_STATUSES) {
      const count = (
        await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM tasks WHERE org_id = $1 AND status = $2", [orgAId, st])
      ).rows[0]!.count;
      expect(res.body.tasks[st]).toBe(count);
    }
    expect(res.body.tasks.BACKLOG).toBe(2);
    expect(res.body.tasks.TODO).toBe(1);

    // Runs 7d counts
    for (const st of RUN_STATUSES) {
      const count = (
        await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM agent_runs WHERE org_id = $1 AND status = $2 AND queued_at >= now() - interval '7 days'",
          [orgAId, st],
        )
      ).rows[0]!.count;
      expect(res.body.runs7d[st]).toBe(count);
    }
    expect(res.body.runs7d.SUCCEEDED).toBe(2); // The 8-day old SUCCEEDED run must NOT be included!
    expect(res.body.runs7d.FAILED).toBe(1); // The 10-day old FAILED run must NOT be included!

    // Recent runs: max 5 newest
    expect(res.body.recentRuns).toHaveLength(5);
    // The top 5 should correspond to hoursAgo: 1, 2, 5, 12, 24
    const expectedTop5Ids = runWithin7d.slice(0, 5).map((r) => r.id);
    const actualIds = res.body.recentRuns.map((r: { id: string }) => r.id);
    expect(actualIds).toEqual(expectedTop5Ids);

    for (const r of res.body.recentRuns) {
      expect(["proj-active-1", "proj-active-2"]).toContain(r.projectSlug);
      expect(typeof r.taskNumber).toBe("number");
      expect(RUN_STATUSES).toContain(r.status);
    }
  });
});

describe("AC-2 Seed org B → dashboard org A không đổi, recentRuns không có run org B", () => {
  it("isolates data completely between org A and org B", async () => {
    // Read org A dashboard before seeding org B
    const beforeA = await api()
      .get("/dashboard")
      .set("Cookie", as("maintA"))
      .expect(200);

    // Seed org B
    const pB = await pool.query<{ id: string }>(
      "INSERT INTO projects (org_id, slug, name, created_by_user_id) VALUES ($1, 'proj-b-1', 'Project B1', $2) RETURNING id",
      [orgBId, userBId],
    );
    await pool.query(
      "INSERT INTO agents (org_id, slug, name, enabled, created_by_user_id) VALUES ($1, 'agent-b-1', 'Agent B1', true, $2)",
      [orgBId, userBId],
    );
    const wB = await pool.query<{ id: string }>(
      "INSERT INTO workers (org_id, slug, name, type, workspace_path, enabled, created_by_user_id) VALUES ($1, 'worker-b-1', 'Worker B1', 'mock', '/srv/w/b1', true, $2) RETURNING id",
      [orgBId, userBId],
    );
    const tB = await pool.query<{ id: string }>(
      "INSERT INTO tasks (org_id, project_id, number, title, status, created_by_user_id) VALUES ($1, $2, 1, 'Task B1', 'BACKLOG', $3) RETURNING id",
      [orgBId, pB.rows[0]!.id, userBId],
    );
    await advanceTask(tB.rows[0]!.id, "TODO");
    const rB = await pool.query<{ id: string }>(
      "INSERT INTO agent_runs (org_id, task_id, worker_id, status, queued_at, created_by_user_id) VALUES ($1, $2, $3, 'QUEUED', now(), $4) RETURNING id",
      [orgBId, tB.rows[0]!.id, wB.rows[0]!.id, userBId],
    );

    // Re-read org A dashboard
    const afterA = await api()
      .get("/dashboard")
      .set("Cookie", as("maintA"))
      .expect(200);

    // Dashboard org A must be completely unchanged
    expect(afterA.body).toEqual(beforeA.body);

    // Verify recentRuns has NO run belonging to org B
    const orgARunIds = afterA.body.recentRuns.map((r: { id: string }) => r.id);
    expect(orgARunIds).not.toContain(rB.rows[0]!.id);

    // Read org B dashboard
    const resB = await api()
      .get("/dashboard")
      .set("Cookie", as("maintB"))
      .expect(200);

    expect(resB.body.projects.active).toBe(1);
    expect(resB.body.agents).toEqual({ enabled: 1, disabled: 0 });
    expect(resB.body.workers).toEqual({ enabled: 1, disabled: 0 });
    expect(resB.body.tasks.TODO).toBe(1);
    expect(resB.body.tasks.BACKLOG).toBe(0);
    expect(resB.body.runs7d.QUEUED).toBe(1);
    expect(resB.body.recentRuns).toHaveLength(1);
    expect(resB.body.recentRuns[0]).toMatchObject({
      id: rB.rows[0]!.id,
      projectSlug: "proj-b-1",
      taskNumber: 1,
      status: "QUEUED",
      finishedAt: null,
    });
  });
});
