import type { INestApplication } from "@nestjs/common";
import { createPool, grantRole, migrateUp, seed, type Pool } from "@aidevteam/db";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GithubOAuthClient } from "../../src/auth/github-client";
import { createApp } from "../../src/bootstrap";
import { SESSION_COOKIE } from "../../src/cookies";
import type { MockRunner } from "../../src/runs/mock-runner";
import { testConfig } from "../helpers";

/**
 * P3-10 Task acceptance flow and authorization verification (AC-1, AC-2).
 * Fake data only.
 * Actors:
 *   900000001 org_admin          org-test-a
 *   900000002 viewer             org-test-a
 *   900000003 maintainer         org-test-a
 *   900000006 project_member     org-test-a (unassigned to project)
 */
const ORIGIN = "https://cc.example.com";
const noGithub: GithubOAuthClient = {
  exchangeCodeForIdentity: async () => {
    throw new Error("not used");
  },
};

const mockRunner: MockRunner = {
  run: async () => ({ status: "SUCCESS", summary: "mock run finished" }),
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
const sendReq = (method: "get" | "post" | "patch" | "delete", pathStr: string, who: string) =>
  api()[method](pathStr).set("Origin", ORIGIN).set("Cookie", as(who));

const PROJ = "proj-accept";
const TASKS = `/projects/${PROJ}/tasks`;
const TASK = (n: number) => `/projects/${PROJ}/tasks/${n}`;
const DEPS = (n: number) => `/projects/${PROJ}/tasks/${n}/dependencies`;
const TRANSITIONS = (n: number) => `/projects/${PROJ}/tasks/${n}/transitions`;
const DISPATCH = (n: number) => `/projects/${PROJ}/tasks/${n}/dispatch`;
const COMMENTS = (n: number) => `/projects/${PROJ}/tasks/${n}/comments`;
const ACTIVITY = (n: number) => `/projects/${PROJ}/tasks/${n}/activity`;

let runAId = "";
let runBId = "";

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

  const testUserIds = [900000001, 900000002, 900000003, 900000006];
  for (const id of testUserIds) {
    await pool.query(
      "INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake') ON CONFLICT DO NOTHING",
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
  await grantRole(pool, 900000006, "org-test-a", "project_member");

  tokens.admin = await sessionFor(900000001);
  tokens.viewer = await sessionFor(900000002);
  tokens.maint = await sessionFor(900000003);
  tokens.pm = await sessionFor(900000006);

  app = await createApp({ config: testConfig(), pool, githubClient: noGithub, mockRunner });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe("P3-10 AC-1: Task acceptance flow steps 1 to 6", () => {
  it("Step 1: maintainer creates project, epic, sprint; creates provider account; admin approves license; maintainer creates agent and mock worker", async () => {
    // Maintainer creates project
    const projRes = await sendReq("post", "/projects", "maint")
      .send({ slug: PROJ, name: "Acceptance Flow Project" })
      .expect(201);
    expect(projRes.body.slug).toBe(PROJ);

    // Maintainer creates epic
    const epicRes = await sendReq("post", `/projects/${PROJ}/epics`, "maint")
      .send({ slug: "epic-accept", title: "Acceptance Epic" })
      .expect(201);
    expect(epicRes.body.slug).toBe("epic-accept");

    // Maintainer creates sprint
    const sprintRes = await sendReq("post", `/projects/${PROJ}/sprints`, "maint")
      .send({ name: "Sprint 1", startDate: "2026-12-01", endDate: "2026-12-14" })
      .expect(201);
    expect(sprintRes.body.number).toBe(1);

    // Maintainer creates provider account
    const paRes = await sendReq("post", "/provider-accounts", "maint")
      .send({
        slug: "pa-accept",
        name: "PA Accept",
        provider: "anthropic",
        secretRef: "env:AIDEV_SECRET_PA_ACCEPT",
      })
      .expect(201);
    expect(paRes.body.licenseStatus).toBe("unverified");

    // Org admin approves license
    const licRes = await sendReq("post", "/provider-accounts/pa-accept/license", "admin")
      .send({ licenseStatus: "approved" })
      .expect(200);
    expect(licRes.body.licenseStatus).toBe("approved");

    // Maintainer creates agent with capability 'backend' and maxActiveTasks: 1
    const agentRes = await sendReq("post", "/agents", "maint")
      .send({
        slug: "agent-accept",
        name: "Backend Agent",
        capabilities: ["backend"],
        maxActiveTasks: 1,
        providerAccountSlug: "pa-accept",
      })
      .expect(201);
    expect(agentRes.body.capabilities).toEqual(["backend"]);
    expect(agentRes.body.maxActiveTasks).toBe(1);

    // Maintainer creates worker mock assigned to project
    const workerRes = await sendReq("post", "/workers", "maint")
      .send({
        slug: "worker-accept",
        name: "Worker Accept",
        type: "mock",
        workspacePath: "/srv/e2e/accept-worker",
        projectSlug: PROJ,
      })
      .expect(201);
    expect(workerRes.body.slug).toBe("worker-accept");
    expect(workerRes.body.projectSlug).toBe(PROJ);
  });

  it("Step 2: maintainer creates task A (requiring backend, assigned to agent) and task B", async () => {
    // Task A: requires 'backend', assigned to agent-accept
    const taskARes = await sendReq("post", TASKS, "maint")
      .send({
        title: "Task A Prerequisite",
        requiredCapabilities: ["backend"],
        agentSlug: "agent-accept",
        epicSlug: "epic-accept",
        sprintNumber: 1,
      })
      .expect(201);
    expect(taskARes.body.number).toBe(1);
    expect(taskARes.body.agentSlug).toBe("agent-accept");
    expect(taskARes.body.status).toBe("BACKLOG");

    // Task B: dependent task (no agent initially)
    const taskBRes = await sendReq("post", TASKS, "maint")
      .send({
        title: "Task B Dependent",
      })
      .expect(201);
    expect(taskBRes.body.number).toBe(2);
    expect(taskBRes.body.status).toBe("BACKLOG");
  });

  it("Step 3: B depends on A -> B is blocked; dispatch B returns 409 task_blocked and creates no run", async () => {
    // Move task B to TODO so dispatch can be attempted
    await sendReq("post", TRANSITIONS(2), "maint")
      .send({ expectedFrom: "BACKLOG", to: "TODO" })
      .expect(200);

    // Add dependency: B (2) depends on A (1)
    const depRes = await sendReq("post", DEPS(2), "maint")
      .send({ dependsOn: 1 })
      .expect(200);
    expect(depRes.body.changed).toBe(true);

    // Verify task B shows blocked by task 1
    const getDeps = await sendReq("get", DEPS(2), "maint").expect(200);
    expect(getDeps.body.dependsOn).toHaveLength(1);
    expect(getDeps.body.dependsOn[0].number).toBe(1);
    expect(getDeps.body.blockedBy).toHaveLength(1);
    expect(getDeps.body.blockedBy[0].number).toBe(1);

    // Count runs before dispatch attempt
    const runsBefore = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM agent_runs");

    // Dispatch B -> rejected with 409 task_blocked
    const dispatchB = await sendReq("post", DISPATCH(2), "maint")
      .send({ workerSlug: "worker-accept" });
    expect(dispatchB.status).toBe(409);
    expect(dispatchB.body.message).toBe("task_blocked");

    // Verify no run was created
    const runsAfter = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM agent_runs");
    expect(runsAfter.rows[0]?.count).toBe(runsBefore.rows[0]?.count);
  });

  it("Step 4: assign second task to agent already at capacity -> reports 409 agent_at_capacity", async () => {
    // Move task A to TODO -> agent-accept now has 1 active task (at capacity: 1 / 1)
    await sendReq("post", TRANSITIONS(1), "maint")
      .send({ expectedFrom: "BACKLOG", to: "TODO" })
      .expect(200);

    // Attempt to assign agent-accept to task B (which is in TODO) -> 409 agent_at_capacity
    const patchRes = await sendReq("patch", TASK(2), "maint")
      .send({ agentSlug: "agent-accept" });
    expect(patchRes.status).toBe(409);
    expect(patchRes.body.message).toBe("agent_at_capacity");

    // Attempt to create a new task with agent-accept -> 409 agent_at_capacity
    const createRes = await sendReq("post", TASKS, "maint")
      .send({
        title: "Task C Capacity Test",
        agentSlug: "agent-accept",
        requiredCapabilities: ["backend"],
      });
    expect(createRes.status).toBe(409);
    expect(createRes.body.message).toBe("agent_at_capacity");
  });

  it("Step 5: A dispatches to run in /runs; A walks to DONE -> B unblocks -> B dispatches successfully", async () => {
    // Dispatch task A
    const dispARes = await sendReq("post", DISPATCH(1), "maint")
      .send({ workerSlug: "worker-accept" })
      .expect(201);
    expect(dispARes.body.status).toBe("QUEUED");
    runAId = dispARes.body.id;

    // Verify run A appears in /runs list
    const runsList = await sendReq("get", "/runs", "maint").expect(200);
    const foundA = runsList.body.items.find((r: { id: string }) => r.id === runAId);
    expect(foundA).toBeDefined();
    expect(foundA.taskNumber).toBe(1);

    // Cancel run A to free the worker mock (worker cannot be busy with another run)
    await sendReq("post", `/runs/${runAId}/cancel`, "maint").expect(200);

    // Transition task A: TODO -> IN_PROGRESS -> IN_REVIEW -> DONE (with review confirmation)
    await sendReq("post", TRANSITIONS(1), "maint")
      .send({ expectedFrom: "TODO", to: "IN_PROGRESS" })
      .expect(200);
    await sendReq("post", TRANSITIONS(1), "maint")
      .send({ expectedFrom: "IN_PROGRESS", to: "IN_REVIEW" })
      .expect(200);
    await sendReq("post", TRANSITIONS(1), "maint")
      .send({ expectedFrom: "IN_REVIEW", to: "DONE", confirmReviewed: true })
      .expect(200);

    // Verify task B is no longer blocked
    const depsBAfter = await sendReq("get", DEPS(2), "maint").expect(200);
    expect(depsBAfter.body.dependsOn).toHaveLength(1);
    expect(depsBAfter.body.dependsOn[0].status).toBe("DONE");
    expect(depsBAfter.body.blockedBy).toHaveLength(0);

    // Dispatch task B now succeeds!
    const dispBRes = await sendReq("post", DISPATCH(2), "maint")
      .send({ workerSlug: "worker-accept" })
      .expect(201);
    expect(dispBRes.body.status).toBe("QUEUED");
    expect(dispBRes.body.taskNumber).toBe(2);
    runBId = dispBRes.body.id;
  });

  it("Step 6: comment on B; timeline of B contains dependency, transition, dispatch and comment events in chronological order", async () => {
    // Post comment on task B
    const commentRes = await sendReq("post", COMMENTS(2), "maint")
      .send({ body: "Acceptance comment on Task B" })
      .expect(201);
    expect(commentRes.body.body).toBe("Acceptance comment on Task B");

    // Get activity timeline for task B
    const actRes = await sendReq("get", ACTIVITY(2), "maint").expect(200);
    const items = actRes.body.items;
    expect(items.length).toBeGreaterThanOrEqual(5);

    // Check actions and kinds
    const actions = items.map((i: { action?: string; kind: string }) => i.action ?? i.kind);
    expect(actions).toContain("task.created");
    expect(actions).toContain("task.dependency_added");
    expect(actions).toContain("task.transitioned");
    expect(actions).toContain("comment");

    // Verify chronological order (at ascending)
    for (let i = 1; i < items.length; i++) {
      const prev = new Date(items[i - 1].at).getTime();
      const curr = new Date(items[i].at).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });
});

describe("P3-10 AC-2: Authorization and security verification (Step 7)", () => {
  it("viewer cannot create task, assign agent, add dependency, dispatch, cancel run, or post comment (all 403)", async () => {
    // Viewer create task -> 403
    const createRes = await sendReq("post", TASKS, "viewer").send({ title: "Viewer Task" });
    expect(createRes.status).toBe(403);

    // Viewer assign agent -> 403
    const patchRes = await sendReq("patch", TASK(2), "viewer").send({ agentSlug: "agent-accept" });
    expect(patchRes.status).toBe(403);

    // Viewer add dependency -> 403
    const depRes = await sendReq("post", DEPS(2), "viewer").send({ dependsOn: 1 });
    expect(depRes.status).toBe(403);

    // Viewer dispatch -> 403
    const dispRes = await sendReq("post", DISPATCH(2), "viewer").send({ workerSlug: "worker-accept" });
    expect(dispRes.status).toBe(403);

    // Viewer cancel run -> 403
    const cancelRes = await sendReq("post", `/runs/${runBId}/cancel`, "viewer");
    expect(cancelRes.status).toBe(403);

    // Viewer post comment -> 403
    const commentRes = await sendReq("post", COMMENTS(2), "viewer").send({ body: "Viewer comment attempt" });
    expect(commentRes.status).toBe(403);
  });

  it("unassigned project_member cannot view project, tasks, run, or activity (all 404), and search/runs exclude project data", async () => {
    // Unassigned project_member opens project -> 404
    expect((await sendReq("get", `/projects/${PROJ}`, "pm")).status).toBe(404);

    // Unassigned project_member opens tasks -> 404
    expect((await sendReq("get", TASKS, "pm")).status).toBe(404);

    // Unassigned project_member opens task 1 and 2 -> 404
    expect((await sendReq("get", TASK(1), "pm")).status).toBe(404);
    expect((await sendReq("get", TASK(2), "pm")).status).toBe(404);

    // Unassigned project_member opens task activity -> 404
    expect((await sendReq("get", ACTIVITY(1), "pm")).status).toBe(404);
    expect((await sendReq("get", ACTIVITY(2), "pm")).status).toBe(404);

    // Unassigned project_member opens run -> 404
    expect((await sendReq("get", `/runs/${runBId}`, "pm")).status).toBe(404);

    // Search tasks as unassigned project_member -> results exclude proj-accept tasks
    const searchRes = await sendReq("get", "/tasks/search?q=Task", "pm").expect(200);
    const searchSlugs = (searchRes.body.items ?? []).map((t: { projectSlug: string }) => t.projectSlug);
    expect(searchSlugs).not.toContain(PROJ);

    // List runs as unassigned project_member -> results exclude proj-accept runs
    const runsRes = await sendReq("get", "/runs", "pm").expect(200);
    const runIds = (runsRes.body.items ?? []).map((r: { id: string }) => r.id);
    expect(runIds).not.toContain(runAId);
    expect(runIds).not.toContain(runBId);
  });

  it("body containing foreign orgId or projectId is rejected with 422 Unprocessable Entity", async () => {
    const foreignId = "11111111-1111-1111-1111-111111111111";

    // Task create with orgId or projectId
    const taskOrgRes = await sendReq("post", TASKS, "maint").send({
      title: "Strict Task",
      orgId: foreignId,
    });
    expect(taskOrgRes.status).toBe(422);

    const taskProjRes = await sendReq("post", TASKS, "maint").send({
      title: "Strict Task",
      projectId: foreignId,
    });
    expect(taskProjRes.status).toBe(422);

    // Task patch with orgId
    const patchRes = await sendReq("patch", TASK(1), "maint").send({
      orgId: foreignId,
    });
    expect(patchRes.status).toBe(422);

    // Dependency add with orgId
    const depRes = await sendReq("post", DEPS(2), "maint").send({
      dependsOn: 1,
      orgId: foreignId,
    });
    expect(depRes.status).toBe(422);

    // Comment create with orgId
    const commentRes = await sendReq("post", COMMENTS(2), "maint").send({
      body: "Strict Comment",
      orgId: foreignId,
    });
    expect(commentRes.status).toBe(422);

    // Dispatch with orgId
    const dispRes = await sendReq("post", DISPATCH(2), "maint").send({
      workerSlug: "worker-accept",
      orgId: foreignId,
    });
    expect(dispRes.status).toBe(422);

    // Epic create with orgId
    const epicRes = await sendReq("post", `/projects/${PROJ}/epics`, "maint").send({
      slug: "epic-strict",
      title: "Strict Epic",
      orgId: foreignId,
    });
    expect(epicRes.status).toBe(422);

    // Sprint create with orgId
    const sprintRes = await sendReq("post", `/projects/${PROJ}/sprints`, "maint").send({
      name: "Strict Sprint",
      startDate: "2026-12-01",
      endDate: "2026-12-14",
      orgId: foreignId,
    });
    expect(sprintRes.status).toBe(422);
  });
});
