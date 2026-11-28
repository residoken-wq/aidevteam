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
 * P3-05 Agent assignment: capabilities and capacity limits
 * Fake data only:
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
const read = (path: string, who: string) => api().get(path).set("Cookie", as(who));

const P = "proj-assign";
const T = (rest = "") => `/projects/${P}/tasks${rest}`;

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

  // Create project in org A
  await write("post", "/projects", "maintA").send({ slug: P, name: "Assignment Project" }).expect(201);

  // Create provider accounts: one approved, one unverified, one prohibited
  await write("post", "/provider-accounts", "maintA").send({
    slug: "pa-approved",
    name: "PA Approved",
    provider: "anthropic",
    secretRef: "env:AIDEV_SECRET_PA_APP",
  }).expect(201);
  await pool.query("UPDATE provider_accounts SET license_status = 'approved' WHERE slug = 'pa-approved'");

  await write("post", "/provider-accounts", "maintA").send({
    slug: "pa-unverified",
    name: "PA Unverified",
    provider: "anthropic",
    secretRef: "env:AIDEV_SECRET_PA_UNV",
  }).expect(201);

  await write("post", "/provider-accounts", "maintA").send({
    slug: "pa-prohibited",
    name: "PA Prohibited",
    provider: "anthropic",
    secretRef: "env:AIDEV_SECRET_PA_PROH",
  }).expect(201);
  await pool.query("UPDATE provider_accounts SET license_status = 'prohibited' WHERE slug = 'pa-prohibited'");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("P3-05 AC-2: disabled/archived agent and unapproved provider account", () => {
  beforeAll(async () => {
    // Agent disabled
    await write("post", "/agents", "maintA").send({
      slug: "agent-disabled",
      name: "Agent Disabled",
    }).expect(201);
    await write("patch", "/agents/agent-disabled", "maintA").send({ enabled: false }).expect(200);

    // Agent archived
    await write("post", "/agents", "maintA").send({
      slug: "agent-archived",
      name: "Agent Archived",
    }).expect(201);
    await write("post", "/agents/agent-archived/archive", "maintA").expect(200);

    // Agent with unapproved provider account
    await write("post", "/agents", "maintA").send({
      slug: "agent-unapproved-pa",
      name: "Agent Unapproved PA",
    }).expect(201);
    // Directly set unverified provider account in DB to simulate state
    const paUnv = await pool.query<{ id: string }>("SELECT id FROM provider_accounts WHERE slug = 'pa-unverified'");
    await pool.query("UPDATE agents SET provider_account_id = $1 WHERE slug = 'agent-unapproved-pa'", [paUnv.rows[0]!.id]);

    // Agent with prohibited provider account
    await write("post", "/agents", "maintA").send({
      slug: "agent-prohibited-pa",
      name: "Agent Prohibited PA",
    }).expect(201);
    const paProh = await pool.query<{ id: string }>("SELECT id FROM provider_accounts WHERE slug = 'pa-prohibited'");
    await pool.query("UPDATE agents SET provider_account_id = $1 WHERE slug = 'agent-prohibited-pa'", [paProh.rows[0]!.id]);
  });

  it("fails assignment with 422 agent_not_assignable when agent is disabled", async () => {
    const res = await write("post", T(), "maintA").send({
      title: "Task with disabled agent",
      agentSlug: "agent-disabled",
    }).expect(422);
    expect(res.body.message).toBe("agent_not_assignable");
  });

  it("fails assignment with 422 agent_not_assignable when agent is archived", async () => {
    const res = await write("post", T(), "maintA").send({
      title: "Task with archived agent",
      agentSlug: "agent-archived",
    }).expect(422);
    expect(res.body.message).toBe("agent_not_assignable");
  });

  it("fails assignment with 422 provider_account_not_licensed when PA is unverified or prohibited", async () => {
    const resUnv = await write("post", T(), "maintA").send({
      title: "Task with unverified PA agent",
      agentSlug: "agent-unapproved-pa",
    }).expect(422);
    expect(resUnv.body.message).toBe("provider_account_not_licensed");

    const resProh = await write("post", T(), "maintA").send({
      title: "Task with prohibited PA agent",
      agentSlug: "agent-prohibited-pa",
    }).expect(422);
    expect(resProh.body.message).toBe("provider_account_not_licensed");
  });
});

describe("P3-05 AC-3: Capability matching", () => {
  beforeAll(async () => {
    await write("post", "/agents", "maintA").send({
      slug: "agent-coder",
      name: "Agent Coder",
      capabilities: ["backend", "nodejs", "postgresql"],
    }).expect(201);
  });

  it("rejects task creation if agent is missing required capabilities and lists missing tags", async () => {
    const res = await write("post", T(), "maintA").send({
      title: "Task requiring frontend",
      agentSlug: "agent-coder",
      requiredCapabilities: ["backend", "react", "css"],
    }).expect(422);

    expect(res.body.message).toBe("agent_capability_mismatch");
    expect(res.body.missing).toEqual(["react", "css"]);
  });

  it("allows task creation when agent has all required capabilities", async () => {
    const res = await write("post", T(), "maintA").send({
      title: "Task requiring backend",
      agentSlug: "agent-coder",
      requiredCapabilities: ["backend", "nodejs"],
    }).expect(201);

    expect(res.body.agentSlug).toBe("agent-coder");
    expect(res.body.requiredCapabilities).toEqual(["backend", "nodejs"]);
  });

  it("rejects updating requiredCapabilities when current agent lacks the new capabilities", async () => {
    const task = (await write("post", T(), "maintA").send({
      title: "Task to update capabilities",
      agentSlug: "agent-coder",
      requiredCapabilities: ["backend"],
    }).expect(201)).body;

    const res = await write("patch", T(`/${task.number}`), "maintA").send({
      requiredCapabilities: ["backend", "python"],
    }).expect(422);

    expect(res.body.message).toBe("agent_capability_mismatch");
    expect(res.body.missing).toEqual(["python"]);
  });

  it("allows unassigning agent (agentSlug: null) regardless of capabilities", async () => {
    const task = (await write("post", T(), "maintA").send({
      title: "Task to unassign",
      agentSlug: "agent-coder",
      requiredCapabilities: ["backend"],
    }).expect(201)).body;

    const updated = (await write("patch", T(`/${task.number}`), "maintA").send({
      agentSlug: null,
      requiredCapabilities: ["python", "rust"],
    }).expect(200)).body;

    expect(updated.agentSlug).toBeNull();
    expect(updated.requiredCapabilities).toEqual(["python", "rust"]);
  });
});

describe("P3-05 AC-4: Capacity limits & concurrency", () => {
  beforeAll(async () => {
    // Agent with max_active_tasks = 1
    await write("post", "/agents", "maintA").send({
      slug: "agent-solo",
      name: "Agent Solo",
      capabilities: ["backend"],
      maxActiveTasks: 1,
    }).expect(201);
  });

  it("enforces max_active_tasks: 409 agent_at_capacity when full", async () => {
    // Task 1 assigned to agent-solo and moved to TODO (now activeTaskCount = 1)
    const t1 = (await write("post", T(), "maintA").send({
      title: "Solo Task 1",
      agentSlug: "agent-solo",
    }).expect(201)).body;

    await write("post", T(`/${t1.number}/transitions`), "maintA").send({
      expectedFrom: "BACKLOG",
      to: "TODO",
    }).expect(200);

    // Creating task with agent-solo now fails with 409 agent_at_capacity
    const resCreate = await write("post", T(), "maintA").send({
      title: "Solo Task 2",
      agentSlug: "agent-solo",
    }).expect(409);
    expect(resCreate.body.message).toBe("agent_at_capacity");

    // Creating unassigned task 2
    const t2 = (await write("post", T(), "maintA").send({
      title: "Solo Task 2 unassigned",
    }).expect(201)).body;

    // Assigning agent-solo to task 2 fails with 409 agent_at_capacity
    const resAssign = await write("patch", T(`/${t2.number}`), "maintA").send({
      agentSlug: "agent-solo",
    }).expect(409);
    expect(resAssign.body.message).toBe("agent_at_capacity");
  });

  it("handles concurrent assignment: exactly one succeeds when only 1 slot is available", async () => {
    // Create new agent with max_active_tasks = 1
    await write("post", "/agents", "maintA").send({
      slug: "agent-race",
      name: "Agent Race",
      capabilities: ["backend"],
      maxActiveTasks: 1,
    }).expect(201);

    // Create 2 tasks in TODO (unassigned)
    const taskA = (await write("post", T(), "maintA").send({ title: "Race Task A" }).expect(201)).body;
    await write("post", T(`/${taskA.number}/transitions`), "maintA").send({ expectedFrom: "BACKLOG", to: "TODO" }).expect(200);

    const taskB = (await write("post", T(), "maintA").send({ title: "Race Task B" }).expect(201)).body;
    await write("post", T(`/${taskB.number}/transitions`), "maintA").send({ expectedFrom: "BACKLOG", to: "TODO" }).expect(200);

    // Concurrently assign agent-race to taskA and taskB
    const [resA, resB] = await Promise.all([
      write("patch", T(`/${taskA.number}`), "maintA").send({ agentSlug: "agent-race" }),
      write("patch", T(`/${taskB.number}`), "maintA").send({ agentSlug: "agent-race" }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const failed = resA.status === 409 ? resA : resB;
    expect(failed.body.message).toBe("agent_at_capacity");
  });

  it("blocks transition from BACKLOG to TODO/IN_PROGRESS when agent capacity is full", async () => {
    // Agent with capacity 1
    await write("post", "/agents", "maintA").send({
      slug: "agent-backlog-race",
      name: "Agent Backlog Race",
      capabilities: ["backend"],
      maxActiveTasks: 1,
    }).expect(201);

    // Task 1 created in BACKLOG assigned to agent
    const t1 = (await write("post", T(), "maintA").send({
      title: "Backlog 1",
      agentSlug: "agent-backlog-race",
    }).expect(201)).body;

    // Task 2 created in BACKLOG assigned to agent (allowed because t1 is still in BACKLOG, not active)
    const t2 = (await write("post", T(), "maintA").send({
      title: "Backlog 2",
      agentSlug: "agent-backlog-race",
    }).expect(201)).body;

    // Move t1 to TODO (takes the 1 slot)
    await write("post", T(`/${t1.number}/transitions`), "maintA").send({
      expectedFrom: "BACKLOG",
      to: "TODO",
    }).expect(200);

    // Now moving t2 to TODO is rejected with 409 agent_at_capacity
    const res = await write("post", T(`/${t2.number}/transitions`), "maintA").send({
      expectedFrom: "BACKLOG",
      to: "TODO",
    }).expect(409);
    expect(res.body.message).toBe("agent_at_capacity");

    // Completing t1 (TODO -> IN_PROGRESS -> IN_REVIEW -> DONE) frees the slot
    await write("post", T(`/${t1.number}/transitions`), "maintA").send({ expectedFrom: "TODO", to: "IN_PROGRESS" }).expect(200);
    await write("post", T(`/${t1.number}/transitions`), "maintA").send({ expectedFrom: "IN_PROGRESS", to: "IN_REVIEW" }).expect(200);
    await write("post", T(`/${t1.number}/transitions`), "maintA").send({ expectedFrom: "IN_REVIEW", to: "DONE", confirmReviewed: true }).expect(200);

    // Now moving t2 to TODO succeeds!
    await write("post", T(`/${t2.number}/transitions`), "maintA").send({
      expectedFrom: "BACKLOG",
      to: "TODO",
    }).expect(200);
  });

  it("allows reducing maxActiveTasks below current active tasks without unassigning, but blocks new assignments", async () => {
    // Agent with capacity 2
    await write("post", "/agents", "maintA").send({
      slug: "agent-shrink",
      name: "Agent Shrink",
      capabilities: ["backend"],
      maxActiveTasks: 2,
    }).expect(201);

    // Assign 2 tasks and move both to TODO
    const t1 = (await write("post", T(), "maintA").send({ title: "Shrink 1", agentSlug: "agent-shrink" }).expect(201)).body;
    await write("post", T(`/${t1.number}/transitions`), "maintA").send({ expectedFrom: "BACKLOG", to: "TODO" }).expect(200);

    const t2 = (await write("post", T(), "maintA").send({ title: "Shrink 2", agentSlug: "agent-shrink" }).expect(201)).body;
    await write("post", T(`/${t2.number}/transitions`), "maintA").send({ expectedFrom: "BACKLOG", to: "TODO" }).expect(200);

    // Reduce maxActiveTasks to 1 (allowed!)
    const updatedAgent = (await write("patch", "/agents/agent-shrink", "maintA").send({
      maxActiveTasks: 1,
    }).expect(200)).body;
    expect(updatedAgent.maxActiveTasks).toBe(1);
    expect(updatedAgent.activeTaskCount).toBe(2);

    // Both tasks remain assigned and can continue
    await write("post", T(`/${t1.number}/transitions`), "maintA").send({ expectedFrom: "TODO", to: "IN_PROGRESS" }).expect(200);

    // But new assignments are blocked
    await write("post", T(), "maintA").send({
      title: "Shrink 3",
      agentSlug: "agent-shrink",
    }).expect(409);
  });
});

describe("P3-05 AC-5: activeTaskCount and RBAC", () => {
  it("activeTaskCount accurately reflects tasks in TODO, IN_PROGRESS, IN_REVIEW across org", async () => {
    await write("post", "/agents", "maintA").send({
      slug: "agent-counter",
      name: "Agent Counter",
      maxActiveTasks: 10,
    }).expect(201);

    let a = (await read("/agents/agent-counter", "maintA").expect(200)).body;
    expect(a.activeTaskCount).toBe(0);

    // BACKLOG does not count
    const t = (await write("post", T(), "maintA").send({ title: "Count task", agentSlug: "agent-counter" }).expect(201)).body;
    a = (await read("/agents/agent-counter", "maintA").expect(200)).body;
    expect(a.activeTaskCount).toBe(0);

    // TODO counts
    await write("post", T(`/${t.number}/transitions`), "maintA").send({ expectedFrom: "BACKLOG", to: "TODO" }).expect(200);
    a = (await read("/agents/agent-counter", "maintA").expect(200)).body;
    expect(a.activeTaskCount).toBe(1);

    // IN_PROGRESS counts
    await write("post", T(`/${t.number}/transitions`), "maintA").send({ expectedFrom: "TODO", to: "IN_PROGRESS" }).expect(200);
    a = (await read("/agents/agent-counter", "maintA").expect(200)).body;
    expect(a.activeTaskCount).toBe(1);

    // IN_REVIEW counts
    await write("post", T(`/${t.number}/transitions`), "maintA").send({ expectedFrom: "IN_PROGRESS", to: "IN_REVIEW" }).expect(200);
    a = (await read("/agents/agent-counter", "maintA").expect(200)).body;
    expect(a.activeTaskCount).toBe(1);

    // CANCELLED frees slot (active count -> 0)
    await write("post", T(`/${t.number}/transitions`), "maintA").send({ expectedFrom: "IN_REVIEW", to: "IN_PROGRESS" }).expect(200);
    await write("post", T(`/${t.number}/transitions`), "maintA").send({ expectedFrom: "IN_PROGRESS", to: "CANCELLED", reason: "testing" }).expect(200);
    a = (await read("/agents/agent-counter", "maintA").expect(200)).body;
    expect(a.activeTaskCount).toBe(0);
  });

  it("viewer cannot assign tasks (403)", async () => {
    await write("post", T(), "viewer").send({
      title: "Viewer try create",
      agentSlug: "agent-counter",
    }).expect(403);
  });
});
