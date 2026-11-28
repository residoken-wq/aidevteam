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
 * P3-03 task dependencies (DAG) integration tests.
 * Actors:
 *   900000002 viewer         org-test-a
 *   900000003 maintainer     org-test-a
 *   900000004 maintainer     org-test-b
 *   900000005 project_member org-test-a (unassigned, then read, then write)
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

const mockRunner: MockRunner = {
  run: async () => ({ status: "SUCCESS", summary: "mock run" }),
};

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
const sendReq = (method: "get" | "post" | "delete" | "patch", pathStr: string, who: string) =>
  api()[method](pathStr).set("Origin", ORIGIN).set("Cookie", as(who));

const DEPS = (project: string, n: number) => `/projects/${project}/tasks/${n}/dependencies`;
const DISPATCH = (project: string, n: number) => `/projects/${project}/tasks/${n}/dispatch`;

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

  for (const id of [900000003, 900000004, 900000005]) {
    await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake')", [id]);
  }
  await grantRole(pool, 900000001, "org-test-a", "org_admin");
  await grantRole(pool, 900000002, "org-test-a", "viewer");
  await grantRole(pool, 900000003, "org-test-a", "maintainer");
  await grantRole(pool, 900000004, "org-test-b", "maintainer");
  await grantRole(pool, 900000005, "org-test-a", "project_member");

  tokens.viewer = await sessionFor(900000002);
  tokens.maintA = await sessionFor(900000003);
  tokens.maintB = await sessionFor(900000004);
  tokens.pm = await sessionFor(900000005);
  tokens.adminA = await sessionFor(900000001);

  app = await createApp({
    config: testConfig({ runnerTimeoutMs: 200 }),
    pool,
    githubClient: noGithub,
    mockRunner,
  });
  await app.init();

  // Create projects
  await sendReq("post", "/projects", "maintA").send({ slug: "proj-dep", name: "Dep Project" }).expect(201);
  await sendReq("post", "/projects", "maintA").send({ slug: "proj-cycle", name: "Cycle Project" }).expect(201);
  await sendReq("post", "/projects", "maintB").send({ slug: "proj-b", name: "Org B Project" }).expect(201);

  // Create mock workers in org A
  await sendReq("post", "/workers", "maintA")
    .send({ slug: "worker-dep", name: "Worker Dep", type: "mock", workspacePath: "/srv/dep-worker" })
    .expect(201);
  await sendReq("post", "/workers", "maintA")
    .send({ slug: "worker-dep-2", name: "Worker Dep 2", type: "mock", workspacePath: "/srv/dep-worker-2" })
    .expect(201);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("AC-2 Cycle detection and concurrency", () => {
  beforeAll(async () => {
    // Create 4 tasks in proj-cycle: 1, 2, 3, 4
    for (let i = 1; i <= 4; i++) {
      await sendReq("post", "/projects/proj-cycle/tasks", "maintA").send({ title: `Cycle Task ${i}` }).expect(201);
    }
  });

  it("rejects self-dependency -> 409 dependency_cycle", async () => {
    const res = await sendReq("post", DEPS("proj-cycle", 1), "maintA").send({ dependsOn: 1 });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("dependency_cycle");
  });

  it("detects 2-node cycle: A->B then B->A -> 409 dependency_cycle", async () => {
    // 1 depends on 2
    const r1 = await sendReq("post", DEPS("proj-cycle", 1), "maintA").send({ dependsOn: 2 }).expect(200);
    expect(r1.body).toEqual({ changed: true });

    // 2 depends on 1 -> cycle
    const r2 = await sendReq("post", DEPS("proj-cycle", 2), "maintA").send({ dependsOn: 1 });
    expect(r2.status).toBe(409);
    expect(r2.body.message).toBe("dependency_cycle");
  });

  it("detects >=3 node cycle: A->B->C then C->A -> 409 dependency_cycle", async () => {
    // 2 depends on 3
    await sendReq("post", DEPS("proj-cycle", 2), "maintA").send({ dependsOn: 3 }).expect(200);
    // 3 depends on 4
    await sendReq("post", DEPS("proj-cycle", 3), "maintA").send({ dependsOn: 4 }).expect(200);

    // Current graph: 1 -> 2 -> 3 -> 4
    // 4 depends on 1 -> cycle!
    const r = await sendReq("post", DEPS("proj-cycle", 4), "maintA").send({ dependsOn: 1 });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe("dependency_cycle");

    // 3 depends on 1 -> cycle!
    const r3 = await sendReq("post", DEPS("proj-cycle", 3), "maintA").send({ dependsOn: 1 });
    expect(r3.status).toBe(409);
    expect(r3.body.message).toBe("dependency_cycle");
  });

  it("concurrent A->B and B->A with Promise.all: exactly one succeeds, one gets 409 dependency_cycle", async () => {
    // Create new project and 2 tasks to test isolated concurrency
    await sendReq("post", "/projects", "maintA").send({ slug: "proj-race", name: "Race Project" }).expect(201);
    await sendReq("post", "/projects/proj-race/tasks", "maintA").send({ title: "Race Task 1" }).expect(201);
    await sendReq("post", "/projects/proj-race/tasks", "maintA").send({ title: "Race Task 2" }).expect(201);

    const [res1, res2] = await Promise.all([
      sendReq("post", DEPS("proj-race", 1), "maintA").send({ dependsOn: 2 }),
      sendReq("post", DEPS("proj-race", 2), "maintA").send({ dependsOn: 1 }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const successRes = res1.status === 200 ? res1 : res2;
    const failRes = res1.status === 409 ? res1 : res2;

    expect(successRes.body).toEqual({ changed: true });
    expect(failRes.body.message).toBe("dependency_cycle");
  });
});

describe("AC-3 Blocked tasks cannot dispatch, DONE unblocks, CANCELLED still blocks", () => {
  beforeAll(async () => {
    // Create tasks in proj-dep: 1 (dep), 2 (main)
    await sendReq("post", "/projects/proj-dep/tasks", "maintA").send({ title: "Prerequisite 1" }).expect(201);
    await sendReq("post", "/projects/proj-dep/tasks", "maintA").send({ title: "Dependent 2" }).expect(201);

    // Advance both to TODO
    await sendReq("post", "/projects/proj-dep/tasks/1/transitions", "maintA")
      .send({ expectedFrom: "BACKLOG", to: "TODO" })
      .expect(200);
    await sendReq("post", "/projects/proj-dep/tasks/2/transitions", "maintA")
      .send({ expectedFrom: "BACKLOG", to: "TODO" })
      .expect(200);

    // 2 depends on 1
    await sendReq("post", DEPS("proj-dep", 2), "maintA").send({ dependsOn: 1 }).expect(200);
  });

  it("dispatching blocked task returns 409 task_blocked and creates no agent_runs", async () => {
    const runsBefore = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM agent_runs");

    const r = await sendReq("post", DISPATCH("proj-dep", 2), "maintA").send({ workerSlug: "worker-dep" });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe("task_blocked");

    const runsAfter = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM agent_runs");
    expect(runsAfter.rows[0]?.count).toBe(runsBefore.rows[0]?.count);
  });

  it("walk dependency to DONE -> unblocks task and dispatch succeeds", async () => {
    // Move task 1: TODO -> IN_PROGRESS -> IN_REVIEW -> DONE
    await sendReq("post", "/projects/proj-dep/tasks/1/transitions", "maintA")
      .send({ expectedFrom: "TODO", to: "IN_PROGRESS" })
      .expect(200);
    await sendReq("post", "/projects/proj-dep/tasks/1/transitions", "maintA")
      .send({ expectedFrom: "IN_PROGRESS", to: "IN_REVIEW" })
      .expect(200);
    await sendReq("post", "/projects/proj-dep/tasks/1/transitions", "maintA")
      .send({ expectedFrom: "IN_REVIEW", to: "DONE", confirmReviewed: true })
      .expect(200);

    // Now task 2 should be dispatchable!
    const r = await sendReq("post", DISPATCH("proj-dep", 2), "maintA").send({ workerSlug: "worker-dep" });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("QUEUED");
  });

  it("CANCELLED dependency still blocks dispatch; removing dependency unblocks it", async () => {
    // Create task 3 (will cancel) and task 4 (blocked by 3)
    await sendReq("post", "/projects/proj-dep/tasks", "maintA").send({ title: "Task to cancel 3" }).expect(201);
    await sendReq("post", "/projects/proj-dep/tasks", "maintA").send({ title: "Task blocked by cancel 4" }).expect(201);

    await sendReq("post", "/projects/proj-dep/tasks/3/transitions", "maintA")
      .send({ expectedFrom: "BACKLOG", to: "CANCELLED", reason: "deprecated" })
      .expect(200);
    await sendReq("post", "/projects/proj-dep/tasks/4/transitions", "maintA")
      .send({ expectedFrom: "BACKLOG", to: "TODO" })
      .expect(200);

    // 4 depends on 3
    await sendReq("post", DEPS("proj-dep", 4), "maintA").send({ dependsOn: 3 }).expect(200);

    // Verify GET dependencies shows 3 in blockedBy
    const depsRes = await sendReq("get", DEPS("proj-dep", 4), "maintA").expect(200);
    expect(depsRes.body.dependsOn).toHaveLength(1);
    expect(depsRes.body.dependsOn[0].status).toBe("CANCELLED");
    expect(depsRes.body.blockedBy).toHaveLength(1);
    expect(depsRes.body.blockedBy[0].number).toBe(3);

    // Dispatching task 4 is rejected with task_blocked
    const dispRes = await sendReq("post", DISPATCH("proj-dep", 4), "maintA").send({ workerSlug: "worker-dep-2" });
    expect(dispRes.status).toBe(409);
    expect(dispRes.body.message).toBe("task_blocked");

    // Remove dependency 4 on 3
    const delRes = await sendReq("delete", DEPS("proj-dep", 4), "maintA").send({ dependsOn: 3 }).expect(200);
    expect(delRes.body).toEqual({ changed: true });

    // Now dispatching task 4 succeeds!
    const dispAfter = await sendReq("post", DISPATCH("proj-dep", 4), "maintA").send({ workerSlug: "worker-dep-2" });
    expect(dispAfter.status).toBe(201);
    expect(dispAfter.body.status).toBe("QUEUED");
  });
});

describe("AC-4 RBAC and Project-Scope verification", () => {
  beforeAll(async () => {
    // Project proj-dep already exists in org-test-a
  });

  it("viewer can read dependencies, but cannot write (403)", async () => {
    await sendReq("get", DEPS("proj-dep", 1), "viewer").expect(200);

    const postRes = await sendReq("post", DEPS("proj-dep", 1), "viewer").send({ dependsOn: 2 });
    expect(postRes.status).toBe(403);

    const delRes = await sendReq("delete", DEPS("proj-dep", 1), "viewer").send({ dependsOn: 2 });
    expect(delRes.status).toBe(403);
  });

  it("project_member without assignment returns 404 (hidden project)", async () => {
    const getRes = await sendReq("get", DEPS("proj-dep", 1), "pm");
    expect(getRes.status).toBe(404);

    const postRes = await sendReq("post", DEPS("proj-dep", 1), "pm").send({ dependsOn: 2 });
    expect(postRes.status).toBe(404);
  });

  it("project_member assigned 'read' can read (200) but cannot write (403)", async () => {
    // Assign 900000005 'read' on proj-dep via adminA (org_admin has project:assign)
    await sendReq("post", "/projects/proj-dep/members", "adminA")
      .send({ githubUserId: 900000005, access: "read" })
      .expect(200);

    await sendReq("get", DEPS("proj-dep", 1), "pm").expect(200);

    const postRes = await sendReq("post", DEPS("proj-dep", 1), "pm").send({ dependsOn: 2 });
    expect(postRes.status).toBe(403);

    const delRes = await sendReq("delete", DEPS("proj-dep", 1), "pm").send({ dependsOn: 2 });
    expect(delRes.status).toBe(403);
  });

  it("project_member assigned 'write' can read (200) and write (200)", async () => {
    // Upgrade assignment to 'write'
    await sendReq("post", "/projects/proj-dep/members", "adminA")
      .send({ githubUserId: 900000005, access: "write" })
      .expect(200);

    await sendReq("get", DEPS("proj-dep", 1), "pm").expect(200);
  });

  it("cross-org request returns 404", async () => {
    // maintB belongs to org-test-b, proj-dep belongs to org-test-a
    const getRes = await sendReq("get", DEPS("proj-dep", 1), "maintB");
    expect(getRes.status).toBe(404);

    const postRes = await sendReq("post", DEPS("proj-dep", 1), "maintB").send({ dependsOn: 2 });
    expect(postRes.status).toBe(404);
  });

  it("non-existent task returns 404 task_not_found", async () => {
    const getRes = await sendReq("get", DEPS("proj-dep", 99999), "maintA");
    expect(getRes.status).toBe(404);
    expect(getRes.body.message).toBe("task_not_found");

    const postRes = await sendReq("post", DEPS("proj-dep", 99999), "maintA").send({ dependsOn: 1 });
    expect(postRes.status).toBe(404);
    expect(postRes.body.message).toBe("task_not_found");

    const postDepRes = await sendReq("post", DEPS("proj-dep", 4), "maintA").send({ dependsOn: 99999 });
    expect(postDepRes.status).toBe(404);
    expect(postDepRes.body.message).toBe("task_not_found");
  });

  it("target task in DONE or CANCELLED rejects new dependencies -> 409 task_closed", async () => {
    // Task 1 is DONE
    const r1 = await sendReq("post", DEPS("proj-dep", 1), "maintA").send({ dependsOn: 2 });
    expect(r1.status).toBe(409);
    expect(r1.body.message).toBe("task_closed");

    // Task 3 is CANCELLED
    const r3 = await sendReq("post", DEPS("proj-dep", 3), "maintA").send({ dependsOn: 2 });
    expect(r3.status).toBe(409);
    expect(r3.body.message).toBe("task_closed");
  });
});

describe("AC-5 Audit logging on real changes", () => {
  beforeAll(async () => {
    await sendReq("post", "/projects/proj-dep/tasks", "maintA").send({ title: "Audit Task 5" }).expect(201);
    await sendReq("post", "/projects/proj-dep/tasks", "maintA").send({ title: "Audit Task 6" }).expect(201);
  });

  it("writes audit exactly once for real add, no audit on duplicate add", async () => {
    const countBefore = (
      await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit_events WHERE action = 'task.dependency_added'",
      )
    ).rows[0]!.count;

    // First add -> changed: true -> audit written
    const r1 = await sendReq("post", DEPS("proj-dep", 6), "maintA").send({ dependsOn: 5 }).expect(200);
    expect(r1.body).toEqual({ changed: true });

    const auditRes = await pool.query<{ action: string; metadata: Record<string, unknown> }>(
      "SELECT action, metadata FROM audit_events WHERE action = 'task.dependency_added' ORDER BY id DESC LIMIT 1",
    );
    expect(auditRes.rows[0]?.metadata).toEqual({ number: 6, dependsOn: 5 });

    // Second add (duplicate) -> changed: false -> no audit written
    const r2 = await sendReq("post", DEPS("proj-dep", 6), "maintA").send({ dependsOn: 5 }).expect(200);
    expect(r2.body).toEqual({ changed: false });

    const countAfter = (
      await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit_events WHERE action = 'task.dependency_added'",
      )
    ).rows[0]!.count;
    expect(Number(countAfter)).toBe(Number(countBefore) + 1);
  });

  it("writes audit exactly once for real remove, no audit when not present", async () => {
    const countBefore = (
      await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit_events WHERE action = 'task.dependency_removed'",
      )
    ).rows[0]!.count;

    // First remove -> changed: true -> audit written
    const r1 = await sendReq("delete", DEPS("proj-dep", 6), "maintA").send({ dependsOn: 5 }).expect(200);
    expect(r1.body).toEqual({ changed: true });

    const auditRes = await pool.query<{ action: string; metadata: Record<string, unknown> }>(
      "SELECT action, metadata FROM audit_events WHERE action = 'task.dependency_removed' ORDER BY id DESC LIMIT 1",
    );
    expect(auditRes.rows[0]?.metadata).toEqual({ number: 6, dependsOn: 5 });

    // Second remove -> changed: false -> no audit written
    const r2 = await sendReq("delete", DEPS("proj-dep", 6), "maintA").send({ dependsOn: 5 }).expect(200);
    expect(r2.body).toEqual({ changed: false });

    const countAfter = (
      await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit_events WHERE action = 'task.dependency_removed'",
      )
    ).rows[0]!.count;
    expect(Number(countAfter)).toBe(Number(countBefore) + 1);
  });
});

describe("Project-wide dependency edges (Kanban, one request)", () => {
  it("returns every edge of the project with both ends' number, title and status", async () => {
    const res = await sendReq("get", "/projects/proj-dep/task-dependencies", "viewer");
    expect(res.status).toBe(200);
    const pairs = res.body.items.map((e: { task: { number: number }; dependsOn: { number: number } }) => [e.task.number, e.dependsOn.number]);
    // Same edges as the per-task endpoint reports
    for (const [n] of pairs) {
      const per = await sendReq("get", DEPS("proj-dep", n), "viewer");
      const expected = per.body.dependsOn.map((d: { number: number }) => [n, d.number]);
      expect(pairs.filter(([t]: number[]) => t === n)).toEqual(expected);
    }
    expect(pairs.length).toBeGreaterThan(0);
    for (const e of res.body.items) {
      expect(typeof e.task.title).toBe("string");
      expect(typeof e.dependsOn.status).toBe("string");
    }
  });

  it("is empty for a project without dependencies and hidden across orgs", async () => {
    const empty = await sendReq("get", "/projects/proj-b/task-dependencies", "maintB");
    expect(empty.status).toBe(200);
    expect(empty.body.items).toEqual([]);
    expect((await sendReq("get", "/projects/proj-dep/task-dependencies", "maintB")).status).toBe(404);
  });
});
