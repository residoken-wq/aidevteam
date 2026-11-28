import { type INestApplication } from "@nestjs/common";
import {
  createPool,
  grantRole,
  migrateUp,
  seed,
  type Pool,
} from "@aidevteam/db";
import { DEFAULT_FORBIDDEN_PATHS, type TaskContract } from "@aidevteam/contracts";
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
    throw new Error("not used in tests");
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
const send = (method: "get" | "post" | "patch" | "put" | "delete", path: string, who: string) =>
  api()[method](path).set("Origin", ORIGIN).set("Cookie", as(who));

const validContract: TaskContract = {
  version: 1,
  objective: "Implement user authentication with OAuth2",
  acceptanceCriteria: [
    { id: "AC-1", text: "Validate OAuth state" },
    { id: "AC-2", text: "Exchange code for token" },
  ],
  allowedPaths: ["src/auth/**", "tests/auth/**"],
  forbiddenPaths: ["dist/**"],
  testCommands: [["pnpm", "test"]],
  outOfScope: ["SAML 2.0 support"],
  notes: "Follow OAuth 2.1 recommendations",
};

let projAId: string;
let task1Id: string;
let taskDoneId: string;
let taskCancelledId: string;

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

  for (const id of [900000001, 900000002, 900000003, 900000004, 900000005, 900000006]) {
    await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake') ON CONFLICT DO NOTHING", [id]);
  }

  // Roles in org-test-a
  await grantRole(pool, 900000001, "org-test-a", "org_admin");
  await grantRole(pool, 900000002, "org-test-a", "viewer");
  await grantRole(pool, 900000003, "org-test-a", "maintainer");
  // 900000004 is in org-test-b
  await grantRole(pool, 900000004, "org-test-b", "org_admin");
  // 900000005: project_member assigned read on proj-contract
  await grantRole(pool, 900000005, "org-test-a", "project_member");
  // 900000006: project_member assigned write on proj-contract
  await grantRole(pool, 900000006, "org-test-a", "project_member");

  for (const [who, id] of [
    ["admin", 900000001],
    ["viewer", 900000002],
    ["maint", 900000003],
    ["adminB", 900000004],
    ["pmRead", 900000005],
    ["pmWrite", 900000006],
  ] as const) {
    tokens[who] = await sessionFor(id);
  }

  app = await createApp({
    config: testConfig({ databaseUrl: url }),
    githubClient: noGithub,
    pool,
  });
  await app.init();

  // Create project in org-test-a
  const p = await send("post", "/projects", "admin").send({ slug: "proj-contract", name: "Contract Project" });
  expect(p.status).toBe(201);
  projAId = p.body.id;

  // Create task 1 (TODO)
  const t1 = await send("post", "/projects/proj-contract/tasks", "maint").send({
    title: "Task One for Contract Testing",
    description: "Initial description",
  });
  expect(t1.status).toBe(201);
  task1Id = t1.body.id;

  // Create task 2 and transition to DONE
  const tDone = await send("post", "/projects/proj-contract/tasks", "maint").send({
    title: "Task Done",
  });
  taskDoneId = tDone.body.id;
  await send("post", `/projects/proj-contract/tasks/${tDone.body.number}/transitions`, "maint").send({
    expectedFrom: "BACKLOG",
    to: "TODO",
  });
  await send("post", `/projects/proj-contract/tasks/${tDone.body.number}/transitions`, "maint").send({
    expectedFrom: "TODO",
    to: "IN_PROGRESS",
  });
  await send("post", `/projects/proj-contract/tasks/${tDone.body.number}/transitions`, "maint").send({
    expectedFrom: "IN_PROGRESS",
    to: "IN_REVIEW",
  });
  await send("post", `/projects/proj-contract/tasks/${tDone.body.number}/transitions`, "maint").send({
    expectedFrom: "IN_REVIEW",
    to: "DONE",
    confirmReviewed: true,
  });

  // Create task 3 and transition to CANCELLED
  const tCancel = await send("post", "/projects/proj-contract/tasks", "maint").send({
    title: "Task Cancelled",
  });
  taskCancelledId = tCancel.body.id;
  await send("post", `/projects/proj-contract/tasks/${tCancel.body.number}/transitions`, "maint").send({
    expectedFrom: "BACKLOG",
    to: "CANCELLED",
    reason: "not needed",
  });

  // Assign pmRead as read-only on proj-contract
  await send("post", "/projects/proj-contract/members", "admin").send({
    githubUserId: 900000005,
    access: "read",
  });

  // Assign pmWrite as write on proj-contract
  await send("post", "/projects/proj-contract/members", "admin").send({
    githubUserId: 900000006,
    access: "write",
  });
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
});

describe("AC-3 API: Task Contract endpoints", () => {
  it("GET returns contract null and effectiveForbiddenPaths containing denylist initially", async () => {
    const res = await send("get", "/projects/proj-contract/tasks/1/contract", "viewer").expect(200);
    expect(res.body.contract).toBeNull();
    expect(Array.isArray(res.body.effectiveForbiddenPaths)).toBe(true);
    for (const d of DEFAULT_FORBIDDEN_PATHS) {
      expect(res.body.effectiveForbiddenPaths).toContain(d);
    }
  });

  it("PUT saves contract and returns saved contract with effectiveForbiddenPaths", async () => {
    const res = await send("put", "/projects/proj-contract/tasks/1/contract", "maint")
      .send(validContract)
      .expect(200);

    expect(res.body.contract).not.toBeNull();
    expect(res.body.contract.version).toBe(1);
    expect(res.body.contract.objective).toBe(validContract.objective);
    expect(res.body.contract.acceptanceCriteria).toEqual(validContract.acceptanceCriteria);
    expect(res.body.effectiveForbiddenPaths).toContain("dist/**");
    for (const d of DEFAULT_FORBIDDEN_PATHS) {
      expect(res.body.effectiveForbiddenPaths).toContain(d);
    }

    // Verify persisted via subsequent GET
    const getRes = await send("get", "/projects/proj-contract/tasks/1/contract", "viewer").expect(200);
    expect(getRes.body.contract.objective).toBe(validContract.objective);
  });

  it("PUT on DONE task returns 409 task_closed", async () => {
    const res = await send("put", "/projects/proj-contract/tasks/2/contract", "maint")
      .send(validContract)
      .expect(409);
    expect(res.body.message).toBe("task_closed");
  });

  it("PUT on CANCELLED task returns 409 task_closed", async () => {
    const res = await send("put", "/projects/proj-contract/tasks/3/contract", "maint")
      .send(validContract)
      .expect(409);
    expect(res.body.message).toBe("task_closed");
  });

  it("GET prompt returns preview prompt containing task info and contract", async () => {
    const res = await send("get", "/projects/proj-contract/tasks/1/contract/prompt", "viewer").expect(200);
    expect(typeof res.body.prompt).toBe("string");
    expect(res.body.prompt).toContain(validContract.objective);
    expect(res.body.prompt).toContain("AC-1");
    expect(res.body.prompt).toContain("Validate OAuth state");
    expect(res.body.prompt).toContain("<<<UNTRUSTED_TASK_DATA");
    expect(res.body.prompt).toContain("UNTRUSTED_TASK_DATA>>>");
  });
});

describe("AC-3 RBAC & Project Scope", () => {
  it("viewer can read contract (200) but cannot write contract (403)", async () => {
    await send("get", "/projects/proj-contract/tasks/1/contract", "viewer").expect(200);
    await send("get", "/projects/proj-contract/tasks/1/contract/prompt", "viewer").expect(200);
    await send("put", "/projects/proj-contract/tasks/1/contract", "viewer")
      .send(validContract)
      .expect(403);
  });

  it("project_member without assignment gets 404 (pretend project does not exist)", async () => {
    // 900000007 as unassigned project_member
    await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES (900000007, 'unassigned') ON CONFLICT DO NOTHING");
    await grantRole(pool, 900000007, "org-test-a", "project_member");
    const unassignedToken = await sessionFor(900000007);

    const resGet = await api()
      .get("/projects/proj-contract/tasks/1/contract")
      .set("Origin", ORIGIN)
      .set("Cookie", `${SESSION_COOKIE}=${unassignedToken}`);
    expect(resGet.status).toBe(404);

    const resPut = await api()
      .put("/projects/proj-contract/tasks/1/contract")
      .set("Origin", ORIGIN)
      .set("Cookie", `${SESSION_COOKIE}=${unassignedToken}`)
      .send(validContract);
    expect(resPut.status).toBe(404);
  });

  it("project_member with read assignment can GET (200) but PUT returns 403", async () => {
    await send("get", "/projects/proj-contract/tasks/1/contract", "pmRead").expect(200);
    await send("get", "/projects/proj-contract/tasks/1/contract/prompt", "pmRead").expect(200);
    await send("put", "/projects/proj-contract/tasks/1/contract", "pmRead")
      .send(validContract)
      .expect(403);
  });

  it("project_member with write assignment can GET (200) and PUT (200)", async () => {
    await send("get", "/projects/proj-contract/tasks/1/contract", "pmWrite").expect(200);
    await send("put", "/projects/proj-contract/tasks/1/contract", "pmWrite")
      .send({
        ...validContract,
        objective: "Updated by pmWrite",
      })
      .expect(200);
  });

  it("cross-org access returns 404", async () => {
    await send("get", "/projects/proj-contract/tasks/1/contract", "adminB").expect(404);
    await send("put", "/projects/proj-contract/tasks/1/contract", "adminB")
      .send(validContract)
      .expect(404);
    await send("get", "/projects/proj-contract/tasks/1/contract/prompt", "adminB").expect(404);
  });
});

describe("AC-2 Denylist in API PUT", () => {
  it("PUT with allowed path belonging to denylist returns 422 path_forbidden", async () => {
    const res = await send("put", "/projects/proj-contract/tasks/1/contract", "maint")
      .send({
        ...validContract,
        allowedPaths: ["src/**", ".env"],
      })
      .expect(422);

    expect(JSON.stringify(res.body)).toContain("path_forbidden");
  });
});

describe("AC-5 Audit logging", () => {
  it("audit event task.contract_updated written exactly once per PUT with counts only", async () => {
    const auditBefore = await pool.query<{ count: string }>(
      "SELECT count(*)::text FROM audit_events WHERE action = 'task.contract_updated'",
    );
    const countBefore = Number(auditBefore.rows[0]?.count ?? 0);

    const customContract: TaskContract = {
      version: 1,
      objective: "Audit test objective",
      acceptanceCriteria: [
        { id: "AC-1", text: "Crit 1" },
        { id: "AC-2", text: "Crit 2" },
        { id: "AC-3", text: "Crit 3" },
      ],
      allowedPaths: ["src/a/**", "src/b/**"],
      forbiddenPaths: ["forbidden/**"],
      testCommands: [["pnpm", "test"], ["pnpm", "lint"]],
      outOfScope: ["OOS 1"],
      notes: "Audit test note",
    };

    await send("put", "/projects/proj-contract/tasks/1/contract", "maint")
      .send(customContract)
      .expect(200);

    const auditAfter = await pool.query<{ count: string }>(
      "SELECT count(*)::text FROM audit_events WHERE action = 'task.contract_updated'",
    );
    const countAfter = Number(auditAfter.rows[0]?.count ?? 0);
    expect(countAfter - countBefore).toBe(1);

    // Verify metadata does NOT contain any contract content (only counts)
    const latestEvent = await pool.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE action = 'task.contract_updated' ORDER BY id DESC LIMIT 1",
    );
    const meta = latestEvent.rows[0]!.metadata;

    expect(meta.acceptanceCriteriaCount).toBe(3);
    expect(meta.allowedPathsCount).toBe(2);
    expect(meta.forbiddenPathsCount).toBe(1);
    expect(meta.testCommandsCount).toBe(2);
    expect(meta.outOfScopeCount).toBe(1);

    // Ensure no content leaked
    const rawMeta = JSON.stringify(meta);
    expect(rawMeta).not.toContain("Audit test objective");
    expect(rawMeta).not.toContain("Crit 1");
    expect(rawMeta).not.toContain("src/a/**");
    expect(rawMeta).not.toContain("forbidden/**");
    expect(rawMeta).not.toContain("Audit test note");
  });
});
