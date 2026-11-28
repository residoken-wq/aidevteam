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
 * P3-07 task activity timeline and comments integration tests.
 * Actors:
 *   900000001 org_admin      org-test-a
 *   900000002 viewer         org-test-a
 *   900000003 maintainer     org-test-a
 *   900000004 maintainer     org-test-b
 *   900000005 project_member org-test-a (unassigned -> read -> write)
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

const ACTIVITY = (project: string, n: number) => `/projects/${project}/tasks/${n}/activity`;
const COMMENTS = (project: string, n: number) => `/projects/${project}/tasks/${n}/comments`;

let orgAId = "";
let userIdMaintA = "";
let pmUserId = "";

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

  const orgs = await pool.query<{ id: string; slug: string }>("SELECT id, slug FROM orgs ORDER BY slug");
  orgAId = orgs.rows.find((o) => o.slug === "org-test-a")!.id;

  for (const id of [900000003, 900000004, 900000005]) {
    await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake')", [id]);
  }
  await grantRole(pool, 900000001, "org-test-a", "org_admin");
  await grantRole(pool, 900000002, "org-test-a", "viewer");
  await grantRole(pool, 900000003, "org-test-a", "maintainer");
  await grantRole(pool, 900000004, "org-test-b", "maintainer");
  await grantRole(pool, 900000005, "org-test-a", "project_member");

  tokens.adminA = await sessionFor(900000001);
  tokens.viewer = await sessionFor(900000002);
  tokens.maintA = await sessionFor(900000003);
  tokens.maintB = await sessionFor(900000004);
  tokens.pm = await sessionFor(900000005);

  const uMaintA = await pool.query<{ id: string }>("SELECT id FROM users WHERE github_user_id = 900000003");
  userIdMaintA = uMaintA.rows[0]!.id;
  const uPm = await pool.query<{ id: string }>("SELECT id FROM users WHERE github_user_id = 900000005");
  pmUserId = uPm.rows[0]!.id;

  app = await createApp({
    config: testConfig({ runnerTimeoutMs: 200 }),
    pool,
    githubClient: noGithub,
    mockRunner,
  });
  await app.init();

  // Create projects
  await sendReq("post", "/projects", "maintA").send({ slug: "proj-act", name: "Activity Project" }).expect(201);
  await sendReq("post", "/projects", "maintB").send({ slug: "proj-act-b", name: "Activity Project B" }).expect(201);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe("AC-2: Timeline union, ordering and pagination", () => {
  let taskNumber: number;

  beforeAll(async () => {
    // Create task
    const t = await sendReq("post", "/projects/proj-act/tasks", "maintA")
      .send({ title: "Task for Timeline" })
      .expect(201);
    taskNumber = t.body.number;

    // Transition task: BACKLOG -> TODO
    await sendReq("post", `/projects/proj-act/tasks/${taskNumber}/transitions`, "maintA")
      .send({ expectedFrom: "BACKLOG", to: "TODO" })
      .expect(200);

    // Create another task for dependency
    const t2 = await sendReq("post", "/projects/proj-act/tasks", "maintA")
      .send({ title: "Dep task" })
      .expect(201);

    // Add dependency
    await sendReq("post", `/projects/proj-act/tasks/${taskNumber}/dependencies`, "maintA")
      .send({ dependsOn: t2.body.number })
      .expect(200);

    // Add comments
    await sendReq("post", COMMENTS("proj-act", taskNumber), "maintA")
      .send({ body: "First comment on task" })
      .expect(201);

    await sendReq("post", COMMENTS("proj-act", taskNumber), "maintA")
      .send({ body: "Second comment on task" })
      .expect(201);
  });

  it("returns both events and comments ordered by (at, id) ascending", async () => {
    const res = await sendReq("get", ACTIVITY("proj-act", taskNumber), "maintA").expect(200);
    const items = res.body.items;
    expect(items.length).toBeGreaterThanOrEqual(5); // created, transitioned, dep_added, commented x2

    const kinds = items.map((i: { kind: string }) => i.kind);
    expect(kinds).toContain("event");
    expect(kinds).toContain("comment");

    // Check chronological ordering
    for (let i = 1; i < items.length; i++) {
      const prev = new Date(items[i - 1].at).getTime();
      const curr = new Date(items[i].at).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }

    // Verify fields of items
    const comments = items.filter((i: { kind: string }) => i.kind === "comment");
    expect(comments.length).toBe(2);
    expect(comments[0].body).toBe("First comment on task");
    expect(comments[0].actorGithubUserId).toBe(900000003);
    expect(comments[0].action).toBeUndefined();

    const events = items.filter((i: { kind: string }) => i.kind === "event");
    const actions = events.map((e: { action: string }) => e.action);
    expect(actions).toContain("task.created");
    expect(actions).toContain("task.transitioned");
    expect(actions).toContain("task.dependency_added");
  });

  it("is deterministic: loading twice yields identical result", async () => {
    const res1 = await sendReq("get", ACTIVITY("proj-act", taskNumber), "maintA").expect(200);
    const res2 = await sendReq("get", ACTIVITY("proj-act", taskNumber), "maintA").expect(200);
    expect(res1.body).toEqual(res2.body);
  });

  it("paginates with limit and offset without duplicates or gaps", async () => {
    const all = await sendReq("get", ACTIVITY("proj-act", taskNumber) + "?limit=100&offset=0", "maintA").expect(200);
    const totalCount = all.body.items.length;
    expect(totalCount).toBeGreaterThanOrEqual(5);

    const page1 = await sendReq("get", ACTIVITY("proj-act", taskNumber) + "?limit=2&offset=0", "maintA").expect(200);
    const page2 = await sendReq("get", ACTIVITY("proj-act", taskNumber) + "?limit=2&offset=2", "maintA").expect(200);
    const page3 = await sendReq("get", ACTIVITY("proj-act", taskNumber) + `?limit=100&offset=4`, "maintA").expect(200);

    expect(page1.body.items).toHaveLength(2);
    expect(page2.body.items).toHaveLength(2);
    expect(page1.body.items[0]).toEqual(all.body.items[0]);
    expect(page1.body.items[1]).toEqual(all.body.items[1]);
    expect(page2.body.items[0]).toEqual(all.body.items[2]);
    expect(page2.body.items[1]).toEqual(all.body.items[3]);

    const combined = [...page1.body.items, ...page2.body.items, ...page3.body.items];
    expect(combined).toEqual(all.body.items);
  });
});

describe("AC-3: Allowlist enforcement on details and secret redaction", () => {
  let taskNumber: number;
  let taskId: string;

  beforeAll(async () => {
    const t = await sendReq("post", "/projects/proj-act/tasks", "maintA")
      .send({ title: "Task for Allowlist Check" })
      .expect(201);
    taskNumber = t.body.number;

    const r = await pool.query<{ id: string }>("SELECT id FROM tasks WHERE number = $1", [taskNumber]);
    taskId = r.rows[0]!.id;

    // Directly insert an audit event with unknown keys, token-like string, and email
    await pool.query(
      `INSERT INTO audit_events (org_id, actor_user_id, actor_github_user_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, 900000003, 'task.custom_probe', 'task', $3, $4)`,
      [
        orgAId,
        userIdMaintA,
        taskId,
        JSON.stringify({
          from: "BACKLOG",
          to: "TODO",
          reason: "Testing with sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456",
          unknown_secret: "super-secret-key",
          auth_token: "ghp_12345678901234567890",
          user_email: "testuser@example.com",
        }),
      ],
    );
  });

  it("details only contains keys from the allowlist, and redacts sensitive strings in allowed keys", async () => {
    const res = await sendReq("get", ACTIVITY("proj-act", taskNumber), "maintA").expect(200);
    const customEvent = res.body.items.find((i: { action?: string }) => i.action === "task.custom_probe");
    expect(customEvent).toBeDefined();

    const details = customEvent.details;
    expect(details).toBeDefined();

    // Allowed keys must be present
    expect(details).toHaveProperty("from", "BACKLOG");
    expect(details).toHaveProperty("to", "TODO");

    // Reason is allowed, but secret pattern must be redacted
    expect(details.reason).toBeDefined();
    expect(details.reason).not.toContain("sk-ant-api03");
    expect(details.reason).toContain("[REDACTED]");

    // Disallowed keys MUST NOT be present
    expect(details).not.toHaveProperty("unknown_secret");
    expect(details).not.toHaveProperty("auth_token");
    expect(details).not.toHaveProperty("user_email");
  });
});

describe("AC-4: RBAC and Project-Scope enforcement", () => {
  let taskNumber: number;
  let projectId: string;

  beforeAll(async () => {
    const t = await sendReq("post", "/projects/proj-act/tasks", "maintA")
      .send({ title: "Task for RBAC Scope" })
      .expect(201);
    taskNumber = t.body.number;

    const p = await pool.query<{ id: string }>("SELECT id FROM projects WHERE slug = 'proj-act'");
    projectId = p.rows[0]!.id;
  });

  it("viewer can read activity, but cannot POST comment (403)", async () => {
    await sendReq("get", ACTIVITY("proj-act", taskNumber), "viewer").expect(200);
    await sendReq("post", COMMENTS("proj-act", taskNumber), "viewer")
      .send({ body: "Viewer attempting comment" })
      .expect(403);
  });

  it("project_member unassigned to project gets 404", async () => {
    await sendReq("get", ACTIVITY("proj-act", taskNumber), "pm").expect(404);
    await sendReq("post", COMMENTS("proj-act", taskNumber), "pm")
      .send({ body: "PM unassigned comment" })
      .expect(404);
  });

  it("project_member assigned 'read' can read activity (200), cannot comment (403)", async () => {
    // Assign read access
    await pool.query(
      `INSERT INTO project_assignments (org_id, project_id, user_id, access)
       VALUES ($1, $2, $3, 'read')
       ON CONFLICT (project_id, user_id) DO UPDATE SET access = 'read'`,
      [orgAId, projectId, pmUserId],
    );

    await sendReq("get", ACTIVITY("proj-act", taskNumber), "pm").expect(200);
    await sendReq("post", COMMENTS("proj-act", taskNumber), "pm")
      .send({ body: "PM read-only trying to comment" })
      .expect(403);
  });

  it("project_member assigned 'write' can POST comment (201)", async () => {
    // Upgrade assignment to write access
    await pool.query(
      `UPDATE project_assignments SET access = 'write' WHERE project_id = $1 AND user_id = $2`,
      [projectId, pmUserId],
    );

    const res = await sendReq("post", COMMENTS("proj-act", taskNumber), "pm")
      .send({ body: "PM write comment" })
      .expect(201);
    expect(res.body.body).toBe("PM write comment");
  });

  it("cross-org access returns 404", async () => {
    // Maintainer from org B tries to access task in org A
    await sendReq("get", ACTIVITY("proj-act", taskNumber), "maintB").expect(404);
    await sendReq("post", COMMENTS("proj-act", taskNumber), "maintB")
      .send({ body: "Cross-org comment" })
      .expect(404);
  });

  it("anonymous access returns 401", async () => {
    await api().get(ACTIVITY("proj-act", taskNumber)).set("Origin", ORIGIN).expect(401);
    await api().post(COMMENTS("proj-act", taskNumber)).set("Origin", ORIGIN).send({ body: "Anon" }).expect(401);
  });
});

describe("AC-5: Comment validation, audit, terminal task commenting, and rate limit", () => {
  let taskNumber: number;
  let taskId: string;

  beforeAll(async () => {
    const t = await sendReq("post", "/projects/proj-act/tasks", "maintA")
      .send({ title: "Task for Comment Validation" })
      .expect(201);
    taskNumber = t.body.number;
    const r = await pool.query<{ id: string }>("SELECT id FROM tasks WHERE number = $1", [taskNumber]);
    taskId = r.rows[0]!.id;
  });

  it("rejects empty body, whitespace-only, or body > 5000 characters with 422", async () => {
    await sendReq("post", COMMENTS("proj-act", taskNumber), "maintA")
      .send({ body: "" })
      .expect(422);

    await sendReq("post", COMMENTS("proj-act", taskNumber), "maintA")
      .send({ body: "    \n\t   " })
      .expect(422);

    await sendReq("post", COMMENTS("proj-act", taskNumber), "maintA")
      .send({ body: "a".repeat(5001) })
      .expect(422);
  });

  it("records task.commented audit event with length only and NO body content", async () => {
    const testBody = "Secret message that must not be in audit metadata!";
    await sendReq("post", COMMENTS("proj-act", taskNumber), "maintA")
      .send({ body: testBody })
      .expect(201);

    const auditRes = await pool.query<{ action: string; metadata: { length?: number; number?: number; body?: string } }>(
      `SELECT action, metadata FROM audit_events
        WHERE org_id = $1 AND target_type = 'task' AND target_id = $2 AND action = 'task.commented'
        ORDER BY id DESC LIMIT 1`,
      [orgAId, taskId],
    );

    expect(auditRes.rowCount).toBe(1);
    const row = auditRes.rows[0]!;
    expect(row.metadata.length).toBe(testBody.length);
    expect(row.metadata.number).toBe(taskNumber);
    expect(row.metadata.body).toBeUndefined();
    expect(JSON.stringify(row.metadata)).not.toContain("Secret message");
  });

  it("allows commenting on CANCELLED or DONE tasks", async () => {
    // Transition task to CANCELLED
    await sendReq("post", `/projects/proj-act/tasks/${taskNumber}/transitions`, "maintA")
      .send({ expectedFrom: "BACKLOG", to: "CANCELLED", reason: "Testing closed comment" })
      .expect(200);

    // Commenting on CANCELLED task must succeed (201)
    const commentOnCancelled = await sendReq("post", COMMENTS("proj-act", taskNumber), "maintA")
      .send({ body: "Comment on cancelled task" })
      .expect(201);
    expect(commentOnCancelled.body.body).toBe("Comment on cancelled task");
  });

  it("enforces rate limit: 30 comments per minute per user", async () => {
    // Create dedicated user session for rate limiting test
    await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES (900000099, 'rate limit test')");
    await grantRole(pool, 900000099, "org-test-a", "maintainer");
    const rateToken = await sessionFor(900000099);
    const sendRateReq = (b: string) =>
      api()
        .post(COMMENTS("proj-act", taskNumber))
        .set("Origin", ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${rateToken}`)
        .send({ body: b });

    // Send 30 comments
    for (let i = 1; i <= 30; i++) {
      const res = await sendRateReq(`Rate comment ${i}`);
      expect(res.status).toBe(201);
    }

    // 31st comment must be rate limited (429)
    const r31 = await sendRateReq("Rate comment 31");
    expect(r31.status).toBe(429);
    expect(r31.body.message).toBe("rate_limit_exceeded");
  }, 15_000);
});
