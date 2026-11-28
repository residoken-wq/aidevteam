import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateUp } from "../../src/migrate";
import { SEED, seed } from "../../src/seed";
import { COMMENT_URL, DIGEST, SHA40, resetSchema, testPool } from "./helpers";

let pool: Pool;
let orgA: string;
let orgB: string;
let userId: string;

beforeAll(async () => {
  pool = testPool();
  await resetSchema(pool);
  await migrateUp(pool);
  await seed(pool, { NODE_ENV: "test" });
  const orgs = await pool.query<{ id: string; slug: string }>("SELECT id, slug FROM orgs ORDER BY slug");
  orgA = orgs.rows[0]!.id;
  orgB = orgs.rows[1]!.id;
  userId = (await pool.query<{ id: string }>("SELECT id FROM users ORDER BY github_user_id LIMIT 1")).rows[0]!.id;
});
afterAll(() => pool.end());

async function insertAudit(): Promise<number> {
  const r = await pool.query<{ id: string }>(
    "INSERT INTO audit_events (org_id, actor_user_id, action, metadata) VALUES ($1, $2, 'test.event', '{}') RETURNING id",
    [orgA, userId],
  );
  return Number(r.rows[0]!.id);
}

function insertApproval(env: string, sha = SHA40, digest = DIGEST) {
  return pool.query(
    `INSERT INTO release_approvals
       (org_id, environment, decision, target_sha, release_manifest_digest, pipeline_run_id, approver_github_user_id, source_comment_url, decided_at)
     VALUES ($1, $2, 'approved', $3, $4, 'run-1', 900000001, $5, now()) RETURNING id`,
    [orgA, env, sha, digest, COMMENT_URL],
  );
}

describe("audit_events is append-only (AC-2)", () => {
  it("allows INSERT", async () => {
    expect(await insertAudit()).toBeGreaterThan(0);
  });

  it("rejects UPDATE", async () => {
    const id = await insertAudit();
    await expect(pool.query("UPDATE audit_events SET action = 'tampered.event' WHERE id = $1", [id])).rejects.toThrow(/append-only/);
  });

  it("rejects DELETE", async () => {
    const id = await insertAudit();
    await expect(pool.query("DELETE FROM audit_events WHERE id = $1", [id])).rejects.toThrow(/append-only/);
  });

  it("rejects TRUNCATE", async () => {
    await expect(pool.query("TRUNCATE audit_events")).rejects.toThrow(/append-only/);
  });

  it("rejects malformed action names and non-object metadata", async () => {
    await expect(pool.query("INSERT INTO audit_events (action) VALUES ('DROP TABLE x')")).rejects.toThrow(/check constraint/);
    await expect(pool.query("INSERT INTO audit_events (action, metadata) VALUES ('a.b', '[1]')")).rejects.toThrow(/check constraint/);
  });
});

describe("release_approvals (AC-3, O-05)", () => {
  it.each(["uat", "production"])("accepts environment %s", async (env) => {
    expect((await insertApproval(env)).rowCount).toBe(1);
  });

  it("rejects other environments", async () => {
    await expect(insertApproval("staging")).rejects.toThrow(/check constraint/);
  });

  it("rejects malformed target_sha and digest", async () => {
    await expect(insertApproval("uat", "abc123")).rejects.toThrow(/check constraint/);
    await expect(insertApproval("uat", SHA40, "sha256:short")).rejects.toThrow(/check constraint/);
  });

  it("is immutable once recorded", async () => {
    const id = (await insertApproval("uat")).rows[0].id;
    await expect(pool.query("UPDATE release_approvals SET decision = 'rejected' WHERE id = $1", [id])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM release_approvals WHERE id = $1", [id])).rejects.toThrow(/append-only/);
  });
});

describe("tenant and identity constraints", () => {
  it("rejects binding a user to a role of another org (no cross-org role binding)", async () => {
    const role = await pool.query<{ id: string }>("INSERT INTO roles (org_id, key, name) VALUES ($1, 'viewer', 'Viewer') RETURNING id", [orgA]);
    await expect(
      pool.query("INSERT INTO role_bindings (org_id, user_id, role_id) VALUES ($1, $2, $3)", [orgB, userId, role.rows[0]!.id]),
    ).rejects.toThrow(/role_bindings_role_same_org_fk/);
    expect(
      (await pool.query("INSERT INTO role_bindings (org_id, user_id, role_id) VALUES ($1, $2, $3)", [orgA, userId, role.rows[0]!.id])).rowCount,
    ).toBe(1);
  });

  it("requires org_id on roles", async () => {
    await expect(pool.query("INSERT INTO roles (key, name) VALUES ('x_role', 'X')")).rejects.toThrow(/null value/);
  });

  it("stores only 32-byte session token hashes", async () => {
    await expect(
      pool.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [userId, Buffer.from("raw-token")]),
    ).rejects.toThrow(/check constraint/);
    const ok = await pool.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [
      userId,
      Buffer.alloc(32, 7),
    ]);
    expect(ok.rowCount).toBe(1);
  });

  it("rejects duplicate GitHub user ids", async () => {
    await expect(pool.query("INSERT INTO users (github_user_id) VALUES ($1)", [SEED.users[0].githubUserId])).rejects.toThrow(/duplicate key/);
  });
});

describe("seed (AC-4)", () => {
  it("is idempotent and contains only obviously fake data", async () => {
    await seed(pool, { NODE_ENV: "test" });
    const users = await pool.query<{ github_user_id: string; github_login: string }>("SELECT github_user_id, github_login FROM users");
    expect(users.rowCount).toBe(SEED.users.length);
    for (const u of users.rows) {
      expect(Number(u.github_user_id)).toBeGreaterThanOrEqual(900000000);
      expect(u.github_login).toMatch(/^test-/);
    }
    const orgs = await pool.query<{ slug: string }>("SELECT slug FROM orgs");
    expect(orgs.rows.map((o) => o.slug).sort()).toEqual(["org-test-a", "org-test-b"]);
  });
});

describe("provider_accounts.secret_ref (P2-07, defence in depth)", () => {
  const insert = (ref: string) =>
    pool.query("INSERT INTO provider_accounts (org_id, slug, name, provider, secret_ref) VALUES ($1, $2, 'X', 'anthropic', $3)", [
      orgA,
      `pa-${Math.random().toString(36).slice(2, 10)}`,
      ref,
    ]);

  it.each(["env:AIDEV_SECRET_CLAUDE", "file:/run/secrets/claude-key"])("accepts reference %s", async (ref) => {
    expect((await insert(ref)).rowCount).toBe(1);
  });

  it.each(["sk-ant-api03-FAKEFAKEFAKEFAKEFAKE", "env:DATABASE_URL", "file:/etc/aidevteam/app.env", "file:/run/secrets/../x"])(
    "the database itself rejects %s",
    async (ref) => {
      await expect(insert(ref)).rejects.toThrow(/check constraint/);
    },
  );
});

describe("provider_accounts.license_status (P2-09)", () => {
  it("defaults to 'unverified'", async () => {
    const slug = `pa-${Math.random().toString(36).slice(2, 10)}`;
    const r = await pool.query<{ license_status: string }>(
      "INSERT INTO provider_accounts (org_id, slug, name, provider, secret_ref) VALUES ($1, $2, 'X', 'anthropic', 'env:AIDEV_SECRET_FOO') RETURNING license_status",
      [orgA, slug],
    );
    expect(r.rows[0]!.license_status).toBe("unverified");
  });

  it.each(["approved", "unverified", "prohibited"])("accepts status %s", async (status) => {
    const slug = `pa-${Math.random().toString(36).slice(2, 10)}`;
    const r = await pool.query(
      "INSERT INTO provider_accounts (org_id, slug, name, provider, secret_ref, license_status) VALUES ($1, $2, 'X', 'anthropic', 'env:AIDEV_SECRET_FOO', $3)",
      [orgA, slug, status],
    );
    expect(r.rowCount).toBe(1);
  });

  it.each(["ok", "invalid", "ACTIVE", "pending"])("rejects invalid status %s", async (status) => {
    const slug = `pa-${Math.random().toString(36).slice(2, 10)}`;
    await expect(
      pool.query(
        "INSERT INTO provider_accounts (org_id, slug, name, provider, secret_ref, license_status) VALUES ($1, $2, 'X', 'anthropic', 'env:AIDEV_SECRET_FOO', $3)",
        [orgA, slug, status],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("workers (P2-08, DB backstop)", () => {
  const insert = (slug: string, path: string, type = "mock", org = orgA) =>
    pool.query("INSERT INTO workers (org_id, slug, name, type, workspace_path) VALUES ($1, $2, 'W', $3, $4)", [org, slug, type, path]);

  it("accepts a mock worker with a normalised absolute path", async () => {
    expect((await insert("w-ok", "/srv/workers/w-ok")).rowCount).toBe(1);
  });

  it.each(["relative/path", "/srv/../etc", "/srv/./x", "/srv//x", "/srv/x/", "/", "/srv/x y"])("rejects workspace path %j", async (path) => {
    await expect(insert(`w-${Math.random().toString(36).slice(2, 8)}`, path)).rejects.toThrow(/check constraint/);
  });

  it("rejects non-mock types and duplicate active paths in the same org", async () => {
    await expect(insert("w-real", "/srv/workers/real", "agy")).rejects.toThrow(/check constraint/);
    await expect(insert("w-dup", "/srv/workers/w-ok")).rejects.toThrow(/duplicate key/);
  });

  it("rejects attaching a worker to another org's project", async () => {
    const p = await pool.query<{ id: string }>("INSERT INTO projects (org_id, slug, name) VALUES ($1, 'proj-b-worker', 'P B') RETURNING id", [orgB]);
    await expect(
      pool.query("INSERT INTO workers (org_id, slug, name, type, workspace_path, project_id) VALUES ($1, 'w-x', 'W', 'mock', '/srv/w-x', $2)", [orgA, p.rows[0]!.id]),
    ).rejects.toThrow(/workers_project_same_org_fk/);
  });
});

describe("agents (P2-05, DB backstop)", () => {
  const insert = (slug: string, extra: { org?: string; model?: string | null; providerId?: string | null; managerId?: string | null } = {}) =>
    pool.query<{ id: string }>(
      "INSERT INTO agents (org_id, slug, name, model, provider_account_id, reports_to_agent_id) VALUES ($1, $2, 'A', $3, $4, $5) RETURNING id",
      [extra.org ?? orgA, slug, extra.model ?? null, extra.providerId ?? null, extra.managerId ?? null],
    );

  it("accepts an agent with a manager in the same org", async () => {
    const lead = await insert("a-lead", { model: "claude-sonnet-x.y" });
    expect((await insert("a-dev", { managerId: lead.rows[0]!.id })).rowCount).toBe(1);
  });

  it.each(["has space", "semi;colon", "-leading", "x".repeat(101)])("rejects model %j", async (model) => {
    await expect(insert(`a-${Math.random().toString(36).slice(2, 8)}`, { model })).rejects.toThrow(/check constraint/);
  });

  it("rejects reporting to itself", async () => {
    const a = await insert("a-self");
    await expect(pool.query("UPDATE agents SET reports_to_agent_id = id WHERE id = $1", [a.rows[0]!.id])).rejects.toThrow(/agents_not_own_manager/);
  });

  it("rejects a manager or provider account from another org", async () => {
    const bLead = await insert("a-b-lead", { org: orgB });
    await expect(insert("a-cross-mgr", { managerId: bLead.rows[0]!.id })).rejects.toThrow(/agents_manager_same_org_fk/);
    const pa = await pool.query<{ id: string }>(
      "INSERT INTO provider_accounts (org_id, slug, name, provider, secret_ref) VALUES ($1, 'pa-b-agent', 'P', 'anthropic', 'env:AIDEV_SECRET_PA_B_AGENT') RETURNING id",
      [orgB],
    );
    await expect(insert("a-cross-pa", { providerId: pa.rows[0]!.id })).rejects.toThrow(/agents_provider_same_org_fk/);
  });
});

describe("tasks (P3-02, DB backstop for STATE_MACHINES §1)", () => {
  let projectA: string;
  let n = 0;
  beforeAll(async () => {
    projectA = (await pool.query<{ id: string }>("INSERT INTO projects (org_id, slug, name) VALUES ($1, 'proj-tasks', 'Tasks') RETURNING id", [orgA])).rows[0]!.id;
  });
  const insert = (status = "BACKLOG") =>
    pool.query<{ id: string }>("INSERT INTO tasks (org_id, project_id, number, title, status) VALUES ($1, $2, $3, 'T', $4) RETURNING id", [orgA, projectA, ++n, status]);
  const move = (id: string, status: string, reason: string | null = null) =>
    pool.query("UPDATE tasks SET status = $2, cancel_reason = $3 WHERE id = $1", [id, status, reason]);

  it("walks the approved path BACKLOG → TODO → IN_PROGRESS → IN_REVIEW → IN_PROGRESS → IN_REVIEW → DONE", async () => {
    const id = (await insert()).rows[0]!.id;
    for (const s of ["TODO", "IN_PROGRESS", "IN_REVIEW", "IN_PROGRESS", "IN_REVIEW", "DONE"]) expect((await move(id, s)).rowCount).toBe(1);
  });

  it("must start in BACKLOG", async () => {
    await expect(insert("DONE")).rejects.toThrow(/start in BACKLOG/);
  });

  it.each([
    ["BACKLOG", "DONE"],
    ["TODO", "IN_REVIEW"],
    ["IN_PROGRESS", "DONE"],
    ["IN_REVIEW", "CANCELLED"],
  ])("refuses %s → %s", async (from, to) => {
    const id = (await insert()).rows[0]!.id;
    const path: Record<string, string[]> = { BACKLOG: [], TODO: ["TODO"], IN_PROGRESS: ["TODO", "IN_PROGRESS"], IN_REVIEW: ["TODO", "IN_PROGRESS", "IN_REVIEW"] };
    for (const s of path[from]!) await move(id, s);
    await expect(move(id, to, to === "CANCELLED" ? "r" : null)).rejects.toThrow(/not allowed/);
  });

  it("terminal states cannot be left; CANCELLED needs a reason and only CANCELLED may have one", async () => {
    const id = (await insert()).rows[0]!.id;
    await expect(move(id, "CANCELLED")).rejects.toThrow(/tasks_cancel_reason_iff_cancelled/);
    expect((await move(id, "CANCELLED", "duplicate")).rowCount).toBe(1);
    await expect(move(id, "BACKLOG")).rejects.toThrow(/not allowed/);
  });

  it("org/project/number are immutable and the project must be in the same org", async () => {
    const id = (await insert()).rows[0]!.id;
    await expect(pool.query("UPDATE tasks SET number = 999 WHERE id = $1", [id])).rejects.toThrow(/immutable/);
    await expect(pool.query("INSERT INTO tasks (org_id, project_id, number, title) VALUES ($1, $2, 9999, 'X')", [orgB, projectA])).rejects.toThrow(/tasks_project_same_org_fk/);
  });
});

describe("agent_runs (P4-01, DB backstop for STATE_MACHINES §2)", () => {
  let projectA: string;
  let projectB: string;
  let taskA: string;
  let taskB: string;
  let workerA: string;
  let workerB: string;

  beforeAll(async () => {
    projectA = (await pool.query<{ id: string }>("INSERT INTO projects (org_id, slug, name) VALUES ($1, 'proj-runs-a', 'Runs A') RETURNING id", [orgA])).rows[0]!.id;
    projectB = (await pool.query<{ id: string }>("INSERT INTO projects (org_id, slug, name) VALUES ($1, 'proj-runs-b', 'Runs B') RETURNING id", [orgB])).rows[0]!.id;
    taskA = (await pool.query<{ id: string }>("INSERT INTO tasks (org_id, project_id, number, title) VALUES ($1, $2, 1, 'Task A') RETURNING id", [orgA, projectA])).rows[0]!.id;
    taskB = (await pool.query<{ id: string }>("INSERT INTO tasks (org_id, project_id, number, title) VALUES ($1, $2, 1, 'Task B') RETURNING id", [orgB, projectB])).rows[0]!.id;
    workerA = (await pool.query<{ id: string }>(
      "INSERT INTO workers (org_id, slug, name, type, workspace_path) VALUES ($1, 'worker-a', 'Worker A', 'mock', '/tmp/worker-a') RETURNING id",
      [orgA],
    )).rows[0]!.id;
    workerB = (await pool.query<{ id: string }>(
      "INSERT INTO workers (org_id, slug, name, type, workspace_path) VALUES ($1, 'worker-b', 'Worker B', 'mock', '/tmp/worker-b') RETURNING id",
      [orgB],
    )).rows[0]!.id;
  });

  const insert = (status = "QUEUED", extra: { org?: string; task?: string; worker?: string } = {}) =>
    pool.query<{ id: string }>(
      "INSERT INTO agent_runs (org_id, task_id, worker_id, status) VALUES ($1, $2, $3, $4) RETURNING id",
      [extra.org ?? orgA, extra.task ?? taskA, extra.worker ?? workerA, status],
    );

  const move = (id: string, status: string) =>
    pool.query("UPDATE agent_runs SET status = $2 WHERE id = $1", [id, status]);

  it("must start in QUEUED", async () => {
    await expect(insert("RUNNING")).rejects.toThrow(/start in QUEUED/);
    await expect(insert("SUCCEEDED")).rejects.toThrow(/start in QUEUED/);
  });

  it("walks QUEUED -> RUNNING -> SUCCEEDED", async () => {
    const id = (await insert()).rows[0]!.id;
    expect((await move(id, "RUNNING")).rowCount).toBe(1);
    expect((await move(id, "SUCCEEDED")).rowCount).toBe(1);
  });

  it("walks QUEUED -> CANCELLED", async () => {
    const id = (await insert()).rows[0]!.id;
    expect((await move(id, "CANCELLED")).rowCount).toBe(1);
  });

  it("walks QUEUED -> RUNNING -> FAILED / CANCELLED / INTERRUPTED", async () => {
    for (const term of ["FAILED", "CANCELLED", "INTERRUPTED"]) {
      const id = (await insert()).rows[0]!.id;
      expect((await move(id, "RUNNING")).rowCount).toBe(1);
      expect((await move(id, term)).rowCount).toBe(1);
    }
  });

  it.each([
    ["QUEUED", "SUCCEEDED"],
    ["QUEUED", "FAILED"],
    ["QUEUED", "INTERRUPTED"],
    ["SUCCEEDED", "RUNNING"],
    ["FAILED", "RUNNING"],
    ["CANCELLED", "RUNNING"],
    ["INTERRUPTED", "RUNNING"],
  ])("refuses %s -> %s", async (from, to) => {
    const id = (await insert()).rows[0]!.id;
    if (from === "RUNNING") {
      await move(id, "RUNNING");
    } else if (from !== "QUEUED") {
      await move(id, "RUNNING");
      await move(id, from);
    }
    await expect(move(id, to)).rejects.toThrow(/not allowed/);
  });

  it("org/task/worker are immutable", async () => {
    const id = (await insert()).rows[0]!.id;
    await expect(pool.query("UPDATE agent_runs SET org_id = $2 WHERE id = $1", [id, orgB])).rejects.toThrow(/immutable/);
    await expect(pool.query("UPDATE agent_runs SET task_id = $2 WHERE id = $1", [id, taskB])).rejects.toThrow(/immutable/);
    await expect(pool.query("UPDATE agent_runs SET worker_id = $2 WHERE id = $1", [id, workerB])).rejects.toThrow(/immutable/);
  });

  it("rejects cross-org task or worker FK", async () => {
    await expect(insert("QUEUED", { task: taskB })).rejects.toThrow(/agent_runs_task_same_org_fk/);
    await expect(insert("QUEUED", { worker: workerB })).rejects.toThrow(/agent_runs_worker_same_org_fk/);
  });
});

describe("project_assignments (P2-13, DB backstop)", () => {
  let projectA: string;
  let projectB: string;
  let userA: string;

  beforeAll(async () => {
    projectA = (await pool.query<{ id: string }>("INSERT INTO projects (org_id, slug, name) VALUES ($1, 'pa-proj-a', 'PA Proj A') RETURNING id", [orgA])).rows[0]!.id;
    projectB = (await pool.query<{ id: string }>("INSERT INTO projects (org_id, slug, name) VALUES ($1, 'pa-proj-b', 'PA Proj B') RETURNING id", [orgB])).rows[0]!.id;
    userA = (await pool.query<{ id: string }>("INSERT INTO users (github_user_id) VALUES (9990001) RETURNING id")).rows[0]!.id;
  });

  it("rejects cross-org project FK", async () => {
    await expect(
      pool.query("INSERT INTO project_assignments (org_id, project_id, user_id, access) VALUES ($1, $2, $3, 'read')", [orgA, projectB, userA]),
    ).rejects.toThrow(/project_assignments_project_same_org_fk/);
  });

  it("rejects invalid access value", async () => {
    await expect(
      pool.query("INSERT INTO project_assignments (org_id, project_id, user_id, access) VALUES ($1, $2, $3, 'admin')", [orgA, projectA, userA]),
    ).rejects.toThrow(/project_assignments_access_check/);
  });

  it("enforces primary key (project_id, user_id)", async () => {
    await pool.query("INSERT INTO project_assignments (org_id, project_id, user_id, access) VALUES ($1, $2, $3, 'read')", [orgA, projectA, userA]);
    await expect(
      pool.query("INSERT INTO project_assignments (org_id, project_id, user_id, access) VALUES ($1, $2, $3, 'write')", [orgA, projectA, userA]),
    ).rejects.toThrow(/project_assignments_pkey/);
  });
});

describe("planning constraints (P3-01, AC-1)", () => {
  let projA: string;
  let projB: string;

  beforeAll(async () => {
    projA = (await pool.query<{ id: string }>("INSERT INTO projects (org_id, slug, name) VALUES ($1, 'plan-proj-a', 'Plan Proj A') RETURNING id", [orgA])).rows[0]!.id;
    projB = (await pool.query<{ id: string }>("INSERT INTO projects (org_id, slug, name) VALUES ($1, 'plan-proj-b', 'Plan Proj B') RETURNING id", [orgB])).rows[0]!.id;
  });

  it("sprints: allows only 1 ACTIVE sprint per project, but different projects can each have 1 ACTIVE sprint", async () => {
    await pool.query(
      "INSERT INTO sprints (org_id, project_id, number, name, start_date, end_date, status) VALUES ($1, $2, 1, 'Sprint 1', '2026-01-01', '2026-01-14', 'PLANNED')",
      [orgA, projA],
    );
    await pool.query("UPDATE sprints SET status = 'ACTIVE' WHERE project_id = $1 AND number = 1", [projA]);

    await pool.query(
      "INSERT INTO sprints (org_id, project_id, number, name, start_date, end_date, status) VALUES ($1, $2, 2, 'Sprint 2', '2026-01-15', '2026-01-28', 'PLANNED')",
      [orgA, projA],
    );
    // Setting second sprint to ACTIVE in projA must fail unique constraint
    await expect(pool.query("UPDATE sprints SET status = 'ACTIVE' WHERE project_id = $1 AND number = 2", [projA])).rejects.toThrow(
      /sprints_one_active_per_project_idx/,
    );

    // Another project can have an ACTIVE sprint
    await pool.query(
      "INSERT INTO sprints (org_id, project_id, number, name, start_date, end_date, status) VALUES ($1, $2, 1, 'Sprint B1', '2026-01-01', '2026-01-14', 'PLANNED')",
      [orgB, projB],
    );
    await expect(pool.query("UPDATE sprints SET status = 'ACTIVE' WHERE project_id = $1 AND number = 1", [projB])).resolves.toBeDefined();
  });

  it("sprints: enforces end_date >= start_date", async () => {
    await expect(
      pool.query(
        "INSERT INTO sprints (org_id, project_id, number, name, start_date, end_date, status) VALUES ($1, $2, 10, 'Invalid dates', '2026-02-15', '2026-02-01', 'PLANNED')",
        [orgA, projA],
      ),
    ).rejects.toThrow(/sprints_dates_check/);
  });

  it("sprints: must start in PLANNED and only transitions PLANNED -> ACTIVE -> CLOSED", async () => {
    await expect(
      pool.query(
        "INSERT INTO sprints (org_id, project_id, number, name, start_date, end_date, status) VALUES ($1, $2, 20, 'Sprint 20', '2026-03-01', '2026-03-14', 'ACTIVE')",
        [orgA, projA],
      ),
    ).rejects.toThrow(/sprint must start in PLANNED/);

    const s = await pool.query<{ id: string }>(
      "INSERT INTO sprints (org_id, project_id, number, name, start_date, end_date, status) VALUES ($1, $2, 20, 'Sprint 20', '2026-03-01', '2026-03-14', 'PLANNED') RETURNING id",
      [orgA, projA],
    );
    const sprintId = s.rows[0]!.id;

    // Disallowed transition PLANNED -> CLOSED
    await expect(pool.query("UPDATE sprints SET status = 'CLOSED' WHERE id = $1", [sprintId])).rejects.toThrow(/not allowed/);

    // Allowed PLANNED -> ACTIVE
    // But projA already has an ACTIVE sprint (Sprint 1), so first close Sprint 1
    await pool.query("UPDATE sprints SET status = 'CLOSED' WHERE project_id = $1 AND number = 1", [projA]);
    await expect(pool.query("UPDATE sprints SET status = 'ACTIVE' WHERE id = $1", [sprintId])).resolves.toBeDefined();

    // Disallowed ACTIVE -> PLANNED
    await expect(pool.query("UPDATE sprints SET status = 'PLANNED' WHERE id = $1", [sprintId])).rejects.toThrow(/not allowed/);

    // Allowed ACTIVE -> CLOSED
    await expect(pool.query("UPDATE sprints SET status = 'CLOSED' WHERE id = $1", [sprintId])).resolves.toBeDefined();

    // Disallowed CLOSED -> ACTIVE
    await expect(pool.query("UPDATE sprints SET status = 'ACTIVE' WHERE id = $1", [sprintId])).rejects.toThrow(/not allowed/);
  });

  it("cross-project foreign key rejection for epics, milestones, sprints and tasks", async () => {
    const msB = (await pool.query<{ id: string }>(
      "INSERT INTO milestones (org_id, project_id, slug, title) VALUES ($1, $2, 'ms-b', 'Milestone B') RETURNING id",
      [orgB, projB],
    )).rows[0]!.id;

    // Epic in projA cannot point to milestone in projB
    await expect(
      pool.query("INSERT INTO epics (org_id, project_id, slug, title, milestone_id) VALUES ($1, $2, 'epic-a', 'Epic A', $3)", [orgA, projA, msB]),
    ).rejects.toThrow(/epics_milestone_same_project_fk/);

    const epicB = (await pool.query<{ id: string }>(
      "INSERT INTO epics (org_id, project_id, slug, title) VALUES ($1, $2, 'epic-b', 'Epic B') RETURNING id",
      [orgB, projB],
    )).rows[0]!.id;

    const sprintB = (await pool.query<{ id: string }>(
      "SELECT id FROM sprints WHERE project_id = $1 AND number = 1",
      [projB],
    )).rows[0]!.id;

    // Task in projA cannot point to epic in projB
    await expect(
      pool.query(
        "INSERT INTO tasks (org_id, project_id, number, title, epic_id) VALUES ($1, $2, 100, 'Task 100', $3)",
        [orgA, projA, epicB],
      ),
    ).rejects.toThrow(/tasks_epic_same_project_fk/);

    // Task in projA cannot point to sprint in projB
    await expect(
      pool.query(
        "INSERT INTO tasks (org_id, project_id, number, title, sprint_id) VALUES ($1, $2, 101, 'Task 101', $3)",
        [orgA, projA, sprintB],
      ),
    ).rejects.toThrow(/tasks_sprint_same_project_fk/);
  });
});

