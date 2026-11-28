import type { INestApplication } from "@nestjs/common";
import { createPool, grantRole, migrateUp, seed, type Pool } from "@aidevteam/db";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GithubOAuthClient } from "../../src/auth/github-client";
import { createApp } from "../../src/bootstrap";
import { SESSION_COOKIE } from "../../src/cookies";
import type { MockRunner, MockRunnerInput } from "../../src/runs/mock-runner";
import { RunWorker } from "../../src/runs/run-worker.service";
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

let runnerFn: (input: MockRunnerInput) => Promise<unknown>;
const mockRunner: MockRunner = {
  run: (input) => runnerFn(input),
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
const write = (method: "post" | "patch", pathStr: string, who: string) =>
  api()[method](pathStr).set("Origin", ORIGIN).set("Cookie", as(who));

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
    await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake') ON CONFLICT DO NOTHING", [id]);
    await pool.query("INSERT INTO users (github_user_id, github_login) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, `test-user-${id}`]);
  }
  await grantRole(pool, 900000002, "org-test-a", "viewer");
  await grantRole(pool, 900000003, "org-test-a", "maintainer");
  await grantRole(pool, 900000004, "org-test-b", "maintainer");
  await grantRole(pool, 900000005, "org-test-a", "project_member");
  tokens.viewer = await sessionFor(900000002);
  tokens.maintA = await sessionFor(900000003);
  tokens.maintB = await sessionFor(900000004);
  tokens.pmA = await sessionFor(900000005);

  runnerFn = async () => ({ status: "SUCCESS", summary: "mock run" });

  app = await createApp({
    config: testConfig({ runnerTimeoutMs: 200 }),
    pool,
    githubClient: noGithub,
    mockRunner,
  });
  await app.init();

  // Create projects
  await write("post", "/projects", "maintA").send({ slug: "alpha", name: "Project Alpha" }).expect(201);
  await write("post", "/projects", "maintB").send({ slug: "beta", name: "Project Beta" }).expect(201);

  // Create tasks and advance to TODO
  await write("post", "/projects/alpha/tasks", "maintA").send({ title: "Task 1" }).expect(201);
  await write("post", "/projects/alpha/tasks/1/transitions", "maintA")
    .send({ expectedFrom: "BACKLOG", to: "TODO" })
    .expect(200);

  await write("post", "/projects/alpha/tasks", "maintA").send({ title: "Task 2" }).expect(201);
  await write("post", "/projects/alpha/tasks/2/transitions", "maintA")
    .send({ expectedFrom: "BACKLOG", to: "TODO" })
    .expect(200);

  await write("post", "/projects/beta/tasks", "maintB").send({ title: "Beta Task 1" }).expect(201);
  await write("post", "/projects/beta/tasks/1/transitions", "maintB")
    .send({ expectedFrom: "BACKLOG", to: "TODO" })
    .expect(200);

  await write("post", "/projects", "maintA").send({ slug: "delta", name: "Project Delta" }).expect(201);
  await write("post", "/projects/delta/tasks", "maintA").send({ title: "Delta Task 1" }).expect(201);
  await write("post", "/projects/delta/tasks/1/transitions", "maintA")
    .send({ expectedFrom: "BACKLOG", to: "TODO" })
    .expect(200);

  // Create workers
  await write("post", "/workers", "maintA")
    .send({ slug: "mock-worker-a", name: "Worker A", type: "mock", workspacePath: "/tmp/mock-worker-a" })
    .expect(201);
  await write("post", "/workers", "maintB")
    .send({ slug: "mock-worker-b", name: "Worker B", type: "mock", workspacePath: "/tmp/mock-worker-b" })
    .expect(201);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await pool.query("DELETE FROM agent_runs");
  await pool.query("DELETE FROM project_assignments WHERE user_id = (SELECT id FROM users WHERE github_user_id = 900000005)");
  runnerFn = async () => ({ status: "SUCCESS", summary: "mock run" });
});

describe("AC-1: dispatch -> QUEUED -> tick -> SUCCEEDED", () => {
  it("walks the successful mock execution path and records audits", async () => {
    runnerFn = async () => ({ status: "SUCCESS", summary: "job completed cleanly" });

    // 1. Dispatch
    const res = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);

    expect(res.body).toMatchObject({
      projectSlug: "alpha",
      taskNumber: 1,
      workerSlug: "mock-worker-a",
      status: "QUEUED",
      attempt: 1,
      startedAt: null,
      finishedAt: null,
      outputSummary: null,
      log: null,
    });
    expect(res.body).not.toHaveProperty("orgId");
    expect(res.body).not.toHaveProperty("org_id");

    const runId = res.body.id;

    // Verify audit for dispatch
    const auditDisp = await pool.query<{ action: string; metadata: Record<string, unknown> }>(
      "SELECT action, metadata FROM audit_events WHERE target_id = $1 AND action = 'run.dispatched'",
      [runId],
    );
    expect(auditDisp.rowCount).toBe(1);
    expect(auditDisp.rows[0]!.metadata).toMatchObject({ runId, taskNumber: 1, from: null, to: "QUEUED" });

    // 2. Tick worker
    const worker = app.get(RunWorker);
    const tickRes = await worker.tick();
    expect(tickRes).toEqual({ processed: true, runId, status: "SUCCEEDED" });

    // 3. Verify run in DB and API
    const runGet = await api().get(`/runs/${runId}`).set("Cookie", as("maintA")).expect(200);
    expect(runGet.body).toMatchObject({
      id: runId,
      status: "SUCCEEDED",
      outputSummary: "job completed cleanly",
    });
    expect(runGet.body.startedAt).not.toBeNull();
    expect(runGet.body.finishedAt).not.toBeNull();

    // Verify audit for finish
    const auditFin = await pool.query<{ action: string; metadata: Record<string, unknown> }>(
      "SELECT action, metadata FROM audit_events WHERE target_id = $1 AND action = 'run.finished'",
      [runId],
    );
    expect(auditFin.rowCount).toBe(1);
    expect(auditFin.rows[0]!.metadata).toMatchObject({ runId, taskNumber: 1, from: "RUNNING", to: "SUCCEEDED" });
  });
});

describe("AC-2: invalid schema / exception / timeout -> FAILED", () => {
  it("fails closed when runner returns invalid output schema", async () => {
    runnerFn = async () => ({ status: "INVALID_STATUS", extra: 123 });

    const res = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);
    const runId = res.body.id;

    const worker = app.get(RunWorker);
    const tickRes = await worker.tick();
    expect(tickRes.status).toBe("FAILED");

    const run = await api().get(`/runs/${runId}`).set("Cookie", as("maintA")).expect(200);
    expect(run.body).toMatchObject({
      id: runId,
      status: "FAILED",
      errorCode: "invalid_output",
    });
  });

  it("fails closed when runner throws an exception", async () => {
    runnerFn = async () => {
      throw new Error("worker execution exploded");
    };

    const res = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);
    const runId = res.body.id;

    const worker = app.get(RunWorker);
    const tickRes = await worker.tick();
    expect(tickRes.status).toBe("FAILED");

    const run = await api().get(`/runs/${runId}`).set("Cookie", as("maintA")).expect(200);
    expect(run.body).toMatchObject({
      id: runId,
      status: "FAILED",
      errorCode: "runner_error",
    });
    expect(run.body.outputSummary).toContain("worker execution exploded");
  });

  it("fails closed when runner times out", async () => {
    runnerFn = async () =>
      new Promise((resolve) => {
        setTimeout(() => resolve({ status: "SUCCESS", summary: "slow" }), 400);
      });

    const res = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);
    const runId = res.body.id;

    const worker = app.get(RunWorker);
    const tickRes = await worker.tick();
    expect(tickRes.status).toBe("FAILED");

    const run = await api().get(`/runs/${runId}`).set("Cookie", as("maintA")).expect(200);
    expect(run.body).toMatchObject({
      id: runId,
      status: "FAILED",
      errorCode: "timeout",
    });
  });
});

describe("AC-3: concurrent cancel during execution keeps CANCELLED", () => {
  it("does not overwrite CANCELLED even when runner finishes successfully afterwards", async () => {
    let finishRunner: () => void;
    const slowExecution = new Promise((resolve) => {
      finishRunner = () => resolve({ status: "SUCCESS", summary: "finished late" });
    });
    runnerFn = () => slowExecution;

    // Dispatch job
    const res = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);
    const runId = res.body.id;

    const worker = app.get(RunWorker);
    // Start tick in background (picks job, sets status='RUNNING', calls mockRunner)
    const tickPromise = worker.tick();

    // Give tick a short tick to ensure it entered RUNNING and is awaiting runnerFn
    await new Promise((r) => setTimeout(r, 50));

    // Verify it is RUNNING in DB
    const checkRunning = await api().get(`/runs/${runId}`).set("Cookie", as("maintA")).expect(200);
    expect(checkRunning.body.status).toBe("RUNNING");

    // Cancel while RUNNING
    const cancelRes = await write("post", `/runs/${runId}/cancel`, "maintA").expect(200);
    expect(cancelRes.body.status).toBe("CANCELLED");

    // Now let the slow runner finish
    finishRunner!();
    const tickResult = await tickPromise;
    expect(tickResult.status).toBe("CANCELLED");

    // Final state MUST remain CANCELLED
    const finalRun = await api().get(`/runs/${runId}`).set("Cookie", as("maintA")).expect(200);
    expect(finalRun.body.status).toBe("CANCELLED");

    // Cannot cancel again -> 409 run_not_cancellable
    await write("post", `/runs/${runId}/cancel`, "maintA").expect(409);
  });
});

describe("AC-4: queue limit > 20 -> 429; worker busy -> 409", () => {
  it("rejects second dispatch when worker is busy (QUEUED or RUNNING)", async () => {
    // 1. Dispatch first run
    await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);

    // 2. Second dispatch while first is still QUEUED -> 409 worker_busy
    const busyRes = await write("post", "/projects/alpha/tasks/2/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(409);
    expect(busyRes.body.message).toBe("worker_busy");

    // Clear the queue
    const worker = app.get(RunWorker);
    await worker.tick();

    // Now worker is free, dispatch succeeds
    await write("post", "/projects/alpha/tasks/2/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);
    await worker.tick();
  });

  it("returns 429 when org queue has 20 QUEUED runs", async () => {
    // Get org A id
    const orgRes = await pool.query<{ id: string }>("SELECT id FROM orgs WHERE slug = 'org-test-a'");
    const orgId = orgRes.rows[0]!.id;
    const taskRes = await pool.query<{ id: string }>("SELECT id FROM tasks WHERE org_id = $1 LIMIT 1", [orgId]);
    const taskId = taskRes.rows[0]!.id;
    const workerRes = await pool.query<{ id: string }>("SELECT id FROM workers WHERE org_id = $1 LIMIT 1", [orgId]);
    const workerId = workerRes.rows[0]!.id;

    // Clear any existing runs in org A
    await pool.query("DELETE FROM agent_runs WHERE org_id = $1", [orgId]);

    // Insert 20 QUEUED runs
    for (let i = 0; i < 20; i++) {
      await pool.query(
        "INSERT INTO agent_runs (org_id, task_id, worker_id, status) VALUES ($1, $2, $3, 'QUEUED')",
        [orgId, taskId, workerId],
      );
    }

    // 21st dispatch attempt gets 429
    const res = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(429);
    expect(res.body.message).toBe("queue_full");

    // Cleanup
    await pool.query("DELETE FROM agent_runs WHERE org_id = $1", [orgId]);
  });
});

describe("AC-5: cross-org isolation and RBAC", () => {
  it("rejects dispatch to worker of another org (404)", async () => {
    await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-b" })
      .expect(404);
  });

  it("rejects dispatch on task of another org (404)", async () => {
    await write("post", "/projects/beta/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(404);
  });

  it("rejects GET /runs/:id for run of another org (404)", async () => {
    // Create run in org B
    const resB = await write("post", "/projects/beta/tasks/1/dispatch", "maintB")
      .send({ workerSlug: "mock-worker-b" })
      .expect(201);
    const runIdB = resB.body.id;

    // Org A maint cannot see org B run
    await api().get(`/runs/${runIdB}`).set("Cookie", as("maintA")).expect(404);
  });

  it("viewer gets 403 on dispatch and cancel", async () => {
    await write("post", "/projects/alpha/tasks/1/dispatch", "viewer")
      .send({ workerSlug: "mock-worker-a" })
      .expect(403);

    // Create a run with maintA
    const res = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);
    const runId = res.body.id;

    // Viewer gets 403 on cancel
    await write("post", `/runs/${runId}/cancel`, "viewer").expect(403);

    // Viewer CAN read runs
    await api().get(`/runs/${runId}`).set("Cookie", as("viewer")).expect(200);
    const listRes = await api().get("/projects/alpha/tasks/1/runs").set("Cookie", as("viewer")).expect(200);
    expect(listRes.body.items.length).toBeGreaterThan(0);

    // Cleanup run
    const worker = app.get(RunWorker);
    await worker.tick();
  });
});

describe("AC-6: app restart moves RUNNING to INTERRUPTED", () => {
  it("marks in-flight runs as INTERRUPTED upon application bootstrap", async () => {
    // 1. Dispatch a run
    const res = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);
    const runId = res.body.id;

    // Move to RUNNING directly in DB (simulating an in-flight worker run before crash)
    await pool.query("UPDATE agent_runs SET status = 'RUNNING', started_at = now() WHERE id = $1", [runId]);

    // Close the current app
    await app.close();

    // 2. Create and init new app on the same database
    app = await createApp({
      config: testConfig({ runnerTimeoutMs: 200 }),
      pool,
      githubClient: noGithub,
      mockRunner,
    });
    await app.init();

    // 3. Verify status changed to INTERRUPTED
    const run = await api().get(`/runs/${runId}`).set("Cookie", as("maintA")).expect(200);
    expect(run.body).toMatchObject({
      id: runId,
      status: "INTERRUPTED",
      errorCode: "interrupted",
    });
    expect(run.body.finishedAt).not.toBeNull();

    // Verify audit
    const audit = await pool.query<{ action: string; metadata: Record<string, unknown> }>(
      "SELECT action, metadata FROM audit_events WHERE target_id = $1 AND action = 'run.finished' AND metadata->>'to' = 'INTERRUPTED'",
      [runId],
    );
    expect(audit.rowCount).toBe(1);
  });
});

describe("AC-7: redaction of tokens and emails in output", () => {
  it("redacts planted secrets from DB, API response, and audit log", async () => {
    const fakeToken = "ghp_123456789012345678901234567890";
    const fakeEmail = "secret.user@example.com";
    runnerFn = async () => ({
      status: "SUCCESS",
      summary: `Found secret ${fakeToken} for ${fakeEmail}`,
    });

    const res = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);
    const runId = res.body.id;

    const worker = app.get(RunWorker);
    await worker.tick();

    // Check DB
    const dbRes = await pool.query<{ output_summary: string; log: string }>(
      "SELECT output_summary, log FROM agent_runs WHERE id = $1",
      [runId],
    );
    expect(dbRes.rows[0]!.output_summary).not.toContain(fakeToken);
    expect(dbRes.rows[0]!.output_summary).not.toContain(fakeEmail);
    expect(dbRes.rows[0]!.output_summary).toContain("[REDACTED]");

    // Check API response
    const apiRes = await api().get(`/runs/${runId}`).set("Cookie", as("maintA")).expect(200);
    expect(JSON.stringify(apiRes.body)).not.toContain(fakeToken);
    expect(JSON.stringify(apiRes.body)).not.toContain(fakeEmail);

    // Check audit log
    const auditRes = await pool.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE target_id = $1",
      [runId],
    );
    for (const a of auditRes.rows) {
      expect(JSON.stringify(a.metadata)).not.toContain(fakeToken);
      expect(JSON.stringify(a.metadata)).not.toContain(fakeEmail);
    }
  });
});

describe("P2-09 AC-5 dispatch binding & license rules", () => {
  it("AC-5a: worker bound to another project -> 409 worker_project_mismatch, no run created", async () => {
    // Create project gamma in org A and a worker attached to project gamma
    await write("post", "/projects", "maintA").send({ slug: "gamma", name: "Project Gamma" }).expect(201);
    const gammaProj = (await pool.query<{ id: string }>("SELECT id FROM projects WHERE slug = 'gamma'")).rows[0]!.id;
    await pool.query(
      `INSERT INTO workers (org_id, slug, name, type, workspace_path, project_id, enabled)
       SELECT id, 'worker-gamma-bound', 'Worker Gamma', 'mock', '/tmp/worker-gamma-bound', $1, true
         FROM orgs WHERE slug = 'org-test-a'`,
      [gammaProj],
    );

    const countBefore = (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM agent_runs")).rows[0]!.count;

    // Dispatch on project alpha with worker bound to project gamma -> 409 worker_project_mismatch
    const res = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "worker-gamma-bound" })
      .expect(409);
    expect(res.body.message).toBe("worker_project_mismatch");

    const countAfter = (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM agent_runs")).rows[0]!.count;
    expect(countAfter).toBe(countBefore);
  });

  it("AC-5b: task with disabled or archived agent -> 409 agent_not_dispatchable, no run created", async () => {
    const orgAId = (await pool.query<{ id: string }>("SELECT id FROM orgs WHERE slug = 'org-test-a'")).rows[0]!.id;
    const task1Id = (await pool.query<{ id: string }>("SELECT id FROM tasks WHERE number = 1 AND project_id = (SELECT id FROM projects WHERE slug = 'alpha')")).rows[0]!.id;

    // Create disabled agent
    const agentRes = await pool.query<{ id: string }>(
      "INSERT INTO agents (org_id, slug, name, enabled) VALUES ($1, 'agent-disabled-dispatch', 'Disabled Agent', false) RETURNING id",
      [orgAId],
    );
    const agentId = agentRes.rows[0]!.id;

    // Attach agent to task 1
    await pool.query("UPDATE tasks SET agent_id = $1 WHERE id = $2", [agentId, task1Id]);

    const countBefore = (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM agent_runs")).rows[0]!.count;

    const res = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(409);
    expect(res.body.message).toBe("agent_not_dispatchable");

    const countAfter = (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM agent_runs")).rows[0]!.count;
    expect(countAfter).toBe(countBefore);

    // If agent is enabled but archived -> also 409 agent_not_dispatchable
    await pool.query("UPDATE agents SET enabled = true, archived_at = now() WHERE id = $1", [agentId]);
    const resArchived = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(409);
    expect(resArchived.body.message).toBe("agent_not_dispatchable");

    // Reset task 1
    await pool.query("UPDATE tasks SET agent_id = NULL WHERE id = $1", [task1Id]);
  });

  it("AC-5c: agent's provider account demoted to prohibited -> 409 provider_account_not_licensed, no run created", async () => {
    const orgAId = (await pool.query<{ id: string }>("SELECT id FROM orgs WHERE slug = 'org-test-a'")).rows[0]!.id;
    const task1Id = (await pool.query<{ id: string }>("SELECT id FROM tasks WHERE number = 1 AND project_id = (SELECT id FROM projects WHERE slug = 'alpha')")).rows[0]!.id;

    // Create provider account with approved status
    const paRes = await pool.query<{ id: string }>(
      "INSERT INTO provider_accounts (org_id, slug, name, provider, secret_ref, license_status) VALUES ($1, 'pa-for-dispatch', 'PA Dispatch', 'anthropic', 'env:AIDEV_SECRET_DISPATCH', 'approved') RETURNING id",
      [orgAId],
    );
    const paId = paRes.rows[0]!.id;

    // Create agent with this account
    const agentRes = await pool.query<{ id: string }>(
      "INSERT INTO agents (org_id, slug, name, enabled, provider_account_id) VALUES ($1, 'agent-licensed-dispatch', 'Licensed Agent', true, $2) RETURNING id",
      [orgAId, paId],
    );
    const agentId = agentRes.rows[0]!.id;

    await pool.query("UPDATE tasks SET agent_id = $1 WHERE id = $2", [agentId, task1Id]);

    // First: dispatch works when approved
    await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);
    await pool.query("DELETE FROM agent_runs");

    // Demote account to prohibited
    await pool.query("UPDATE provider_accounts SET license_status = 'prohibited' WHERE id = $1", [paId]);

    const countBefore = (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM agent_runs")).rows[0]!.count;

    const res = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(409);
    expect(res.body.message).toBe("provider_account_not_licensed");

    const countAfter = (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM agent_runs")).rows[0]!.count;
    expect(countAfter).toBe(countBefore);

    // Reset task 1
    await pool.query("UPDATE tasks SET agent_id = NULL WHERE id = $1", [task1Id]);
  });

  it("AC-5d: task without agent + worker without project -> 201 as before", async () => {
    const task1Id = (await pool.query<{ id: string }>("SELECT id FROM tasks WHERE number = 1 AND project_id = (SELECT id FROM projects WHERE slug = 'alpha')")).rows[0]!.id;
    await pool.query("UPDATE tasks SET agent_id = NULL WHERE id = $1", [task1Id]);
    await pool.query("DELETE FROM agent_runs");

    const res = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);
    expect(res.body.status).toBe("QUEUED");
  });
});

describe("P3-09: GET /runs (AC-1, AC-2, project-scoping, cross-org)", () => {
  it("AC-1: filters correctly, paginates with total, and validates query schema (422)", async () => {
    // 1. Dispatch two runs in org-test-a
    const d1 = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);
    const run1Id = d1.body.id;

    // Tick run 1 to SUCCEEDED
    const worker = app.get(RunWorker);
    await worker.tick();

    const d2 = await write("post", "/projects/alpha/tasks/2/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);
    const run2Id = d2.body.id;

    // List all runs (no filters) -> returns both, sorted by queued_at DESC, id
    const resAll = await api().get("/runs").set("Cookie", as("maintA")).expect(200);
    expect(resAll.body.total).toBe(2);
    expect(resAll.body.limit).toBe(50);
    expect(resAll.body.offset).toBe(0);
    expect(resAll.body.items).toHaveLength(2);
    expect(resAll.body.items[0].id).toBe(run2Id);
    expect(resAll.body.items[1].id).toBe(run1Id);

    // Filter by single status
    const resQueued = await api().get("/runs?status=QUEUED").set("Cookie", as("maintA")).expect(200);
    expect(resQueued.body.total).toBe(1);
    expect(resQueued.body.items[0].id).toBe(run2Id);
    expect(resQueued.body.items[0].status).toBe("QUEUED");

    const resSucceeded = await api().get("/runs?status=SUCCEEDED").set("Cookie", as("maintA")).expect(200);
    expect(resSucceeded.body.total).toBe(1);
    expect(resSucceeded.body.items[0].id).toBe(run1Id);
    expect(resSucceeded.body.items[0].status).toBe("SUCCEEDED");

    // Filter by comma-separated statuses
    const resMultiComma = await api().get("/runs?status=QUEUED,SUCCEEDED").set("Cookie", as("maintA")).expect(200);
    expect(resMultiComma.body.total).toBe(2);
    expect(resMultiComma.body.items).toHaveLength(2);

    // Filter by repeated status query params
    const resMultiArray = await api().get("/runs?status=QUEUED&status=SUCCEEDED").set("Cookie", as("maintA")).expect(200);
    expect(resMultiArray.body.total).toBe(2);

    // Filter by status with no matches
    const resFailed = await api().get("/runs?status=FAILED").set("Cookie", as("maintA")).expect(200);
    expect(resFailed.body.total).toBe(0);
    expect(resFailed.body.items).toHaveLength(0);

    // Filter by project
    const resProjAlpha = await api().get("/runs?project=alpha").set("Cookie", as("maintA")).expect(200);
    expect(resProjAlpha.body.total).toBe(2);

    const resProjDelta = await api().get("/runs?project=delta").set("Cookie", as("maintA")).expect(200);
    expect(resProjDelta.body.total).toBe(0);

    // Filter by worker
    const resWorkerA = await api().get("/runs?worker=mock-worker-a").set("Cookie", as("maintA")).expect(200);
    expect(resWorkerA.body.total).toBe(2);

    const resWorkerB = await api().get("/runs?worker=mock-worker-b").set("Cookie", as("maintA")).expect(200);
    expect(resWorkerB.body.total).toBe(0);

    // Pagination (limit, offset)
    const resPage1 = await api().get("/runs?limit=1&offset=0").set("Cookie", as("maintA")).expect(200);
    expect(resPage1.body.total).toBe(2);
    expect(resPage1.body.limit).toBe(1);
    expect(resPage1.body.offset).toBe(0);
    expect(resPage1.body.items).toHaveLength(1);
    expect(resPage1.body.items[0].id).toBe(run2Id);

    const resPage2 = await api().get("/runs?limit=1&offset=1").set("Cookie", as("maintA")).expect(200);
    expect(resPage2.body.total).toBe(2);
    expect(resPage2.body.limit).toBe(1);
    expect(resPage2.body.offset).toBe(1);
    expect(resPage2.body.items).toHaveLength(1);
    expect(resPage2.body.items[0].id).toBe(run1Id);

    // Query validation errors (422)
    await api().get("/runs?status=INVALID_STATUS").set("Cookie", as("maintA")).expect(422);
    await api().get("/runs?limit=101").set("Cookie", as("maintA")).expect(422);
    await api().get("/runs?limit=0").set("Cookie", as("maintA")).expect(422);
    await api().get("/runs?offset=-1").set("Cookie", as("maintA")).expect(422);
    await api().get("/runs?project=INVALID_SLUG").set("Cookie", as("maintA")).expect(422);
    await api().get("/runs?unknown=foo").set("Cookie", as("maintA")).expect(422);
  });

  it("AC-1: cross-org isolation: runs in org-test-b never leak into org-test-a", async () => {
    // Dispatch in org-test-a
    const dA = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);

    // Dispatch in org-test-b
    const dB = await write("post", "/projects/beta/tasks/1/dispatch", "maintB")
      .send({ workerSlug: "mock-worker-b" })
      .expect(201);

    // maintA (org-test-a) sees only dA
    const resA = await api().get("/runs").set("Cookie", as("maintA")).expect(200);
    expect(resA.body.items.some((r: { id: string }) => r.id === dA.body.id)).toBe(true);
    expect(resA.body.items.some((r: { id: string }) => r.id === dB.body.id)).toBe(false);

    // maintB (org-test-b) sees only dB
    const resB = await api().get("/runs").set("Cookie", as("maintB")).expect(200);
    expect(resB.body.items.some((r: { id: string }) => r.id === dB.body.id)).toBe(true);
    expect(resB.body.items.some((r: { id: string }) => r.id === dA.body.id)).toBe(false);
  });

  it("AC-1: project_member only sees runs of assigned projects", async () => {
    // 1. Dispatch a run in project alpha, advance to SUCCEEDED to free worker, then dispatch in project delta
    const dAlpha = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);

    const worker = app.get(RunWorker);
    await worker.tick();

    const dDelta = await write("post", "/projects/delta/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);

    // 2. User pmA has project_member role but NO assignments -> sees 0 runs
    const resUnassigned = await api().get("/runs").set("Cookie", as("pmA")).expect(200);
    expect(resUnassigned.body.total).toBe(0);
    expect(resUnassigned.body.items).toHaveLength(0);

    // 3. Assign pmA to project alpha
    const orgAId = (await pool.query<{ id: string }>("SELECT id FROM orgs WHERE slug = 'org-test-a'")).rows[0]!.id;
    const alphaId = (await pool.query<{ id: string }>("SELECT id FROM projects WHERE slug = 'alpha'")).rows[0]!.id;
    const deltaId = (await pool.query<{ id: string }>("SELECT id FROM projects WHERE slug = 'delta'")).rows[0]!.id;
    const pmUserId = (await pool.query<{ id: string }>("SELECT id FROM users WHERE github_user_id = 900000005")).rows[0]!.id;

    await pool.query(
      "INSERT INTO project_assignments (org_id, project_id, user_id, access, created_by_user_id) VALUES ($1, $2, $3, 'read', $3)",
      [orgAId, alphaId, pmUserId],
    );

    // pmA now sees only run from project alpha
    const resAlphaOnly = await api().get("/runs").set("Cookie", as("pmA")).expect(200);
    expect(resAlphaOnly.body.total).toBe(1);
    expect(resAlphaOnly.body.items).toHaveLength(1);
    expect(resAlphaOnly.body.items[0].id).toBe(dAlpha.body.id);
    expect(resAlphaOnly.body.items[0].projectSlug).toBe("alpha");

    // 4. Assign pmA to project delta as well
    await pool.query(
      "INSERT INTO project_assignments (org_id, project_id, user_id, access, created_by_user_id) VALUES ($1, $2, $3, 'read', $3)",
      [orgAId, deltaId, pmUserId],
    );

    // pmA now sees runs from both alpha and delta
    const resBoth = await api().get("/runs").set("Cookie", as("pmA")).expect(200);
    expect(resBoth.body.total).toBe(2);
    expect(resBoth.body.items).toHaveLength(2);
    expect(resBoth.body.items.some((r: { id: string }) => r.id === dDelta.body.id)).toBe(true);
    const slugs = resBoth.body.items.map((r: { projectSlug: string }) => r.projectSlug);
    expect(slugs).toContain("alpha");
    expect(slugs).toContain("delta");
  });

  it("AC-2: viewer can access GET /runs (200), but POST /runs/:id/cancel returns 403", async () => {
    const d = await write("post", "/projects/alpha/tasks/1/dispatch", "maintA")
      .send({ workerSlug: "mock-worker-a" })
      .expect(201);
    const runId = d.body.id;

    // Viewer can view runs
    const resViewer = await api().get("/runs").set("Cookie", as("viewer")).expect(200);
    expect(resViewer.body.total).toBeGreaterThanOrEqual(1);

    // Viewer attempts to cancel -> 403 Forbidden
    await api().post(`/runs/${runId}/cancel`).set("Origin", ORIGIN).set("Cookie", as("viewer")).expect(403);
  });
});

describe("AC-8: static checks (no child_process, no agy/antigravity)", () => {
  it("apps/api/src contains no child_process imports and no agy or antigravity strings", () => {
    const srcDir = path.resolve(__dirname, "../../src");

    function getFiles(dir: string): string[] {
      const entries = readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) files.push(...getFiles(full));
        else if (/\.(ts|js)$/.test(e.name)) files.push(full);
      }
      return files;
    }

    const files = getFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      expect(content, `child_process found in ${file}`).not.toMatch(/child_process/);
      expect(content, `forbidden string found in ${file}`).not.toMatch(/\b(agy|antigravity)\b/i);
    }
  });
});
