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

  for (const id of [900000003, 900000004]) {
    await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake')", [id]);
  }
  await grantRole(pool, 900000002, "org-test-a", "viewer");
  await grantRole(pool, 900000003, "org-test-a", "maintainer");
  await grantRole(pool, 900000004, "org-test-b", "maintainer");
  tokens.viewer = await sessionFor(900000002);
  tokens.maintA = await sessionFor(900000003);
  tokens.maintB = await sessionFor(900000004);

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
