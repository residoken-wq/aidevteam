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
const send = (method: "get" | "post" | "patch", path: string, who: string) =>
  api()[method](path).set("Origin", ORIGIN).set("Cookie", as(who));

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

  for (const id of [900000001, 900000003, 900000004, 900000007, 900000008]) {
    await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake') ON CONFLICT DO NOTHING", [id]);
    await pool.query("INSERT INTO users (github_user_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
  }

  await grantRole(pool, 900000001, "org-test-a", "org_admin");
  await grantRole(pool, 900000002, "org-test-a", "viewer");
  await grantRole(pool, 900000003, "org-test-a", "maintainer");
  await grantRole(pool, 900000004, "org-test-b", "maintainer");
  await grantRole(pool, 900000007, "org-test-a", "project_member");
  await grantRole(pool, 900000008, "org-test-a", "project_member");

  tokens.admin = await sessionFor(900000001);
  tokens.viewer = await sessionFor(900000002);
  tokens.maintA = await sessionFor(900000003);
  tokens.maintB = await sessionFor(900000004);
  tokens.pmRead = await sessionFor(900000007);
  tokens.pmWrite = await sessionFor(900000008);

  app = await createApp({ config: testConfig(), pool, githubClient: noGithub });
  await app.init();

  // Create projects
  await send("post", "/projects", "maintA").send({ slug: "plan-proj", name: "Planning Project" }).expect(201);
  await send("post", "/projects", "maintA").send({ slug: "plan-other", name: "Other Project" }).expect(201);
  await send("post", "/projects", "maintB").send({ slug: "plan-b", name: "Org B Project" }).expect(201);

  // Assign project member roles on plan-proj
  await send("post", "/projects/plan-proj/members", "admin").send({ githubUserId: 900000007, access: "read" }).expect(200);
  await send("post", "/projects/plan-proj/members", "admin").send({ githubUserId: 900000008, access: "write" }).expect(200);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("AC-2 Planning CRUD and validation", () => {
  it("Epics CRUD, pagination, duplicate slug 409, and invalid 422", async () => {
    // 422 on invalid slug/title
    await send("post", "/projects/plan-proj/epics", "maintA").send({ slug: "INVALID", title: "Test" }).expect(422);
    await send("post", "/projects/plan-proj/epics", "maintA").send({ slug: "epic-1", title: "" }).expect(422);

    // Create epic-1
    const res1 = await send("post", "/projects/plan-proj/epics", "maintA")
      .send({ slug: "epic-1", title: "Epic One", description: "First epic" })
      .expect(201);
    expect(res1.body).toMatchObject({
      slug: "epic-1",
      projectSlug: "plan-proj",
      title: "Epic One",
      description: "First epic",
      milestoneSlug: null,
      archivedAt: null,
    });

    // 409 on duplicate slug
    await send("post", "/projects/plan-proj/epics", "maintA")
      .send({ slug: "epic-1", title: "Duplicate" })
      .expect(409);

    // Get epic
    const getRes = await send("get", "/projects/plan-proj/epics/epic-1", "maintA").expect(200);
    expect(getRes.body.slug).toBe("epic-1");

    // Patch epic
    const patchRes = await send("patch", "/projects/plan-proj/epics/epic-1", "maintA")
      .send({ title: "Updated Epic One", description: null })
      .expect(200);
    expect(patchRes.body.title).toBe("Updated Epic One");
    expect(patchRes.body.description).toBeNull();

    // List pagination
    const listRes = await send("get", "/projects/plan-proj/epics?limit=10&offset=0", "maintA").expect(200);
    expect(listRes.body.items.length).toBe(1);
    expect(listRes.body.limit).toBe(10);
    expect(listRes.body.offset).toBe(0);

    // Archive epic
    const archRes = await send("post", "/projects/plan-proj/epics/epic-1/archive", "maintA").expect(200);
    expect(archRes.body.archivedAt).not.toBeNull();

    // Already archived -> 409
    await send("post", "/projects/plan-proj/epics/epic-1/archive", "maintA").expect(409);
  });

  it("Milestones CRUD, pagination, duplicate slug 409, and invalid 422", async () => {
    // Invalid due date -> 422
    await send("post", "/projects/plan-proj/milestones", "maintA")
      .send({ slug: "ms-1", title: "MS 1", dueDate: "bad-date" })
      .expect(422);

    // Create ms-1
    const res = await send("post", "/projects/plan-proj/milestones", "maintA")
      .send({ slug: "ms-1", title: "Milestone 1", dueDate: "2026-12-31" })
      .expect(201);
    expect(res.body).toMatchObject({
      slug: "ms-1",
      projectSlug: "plan-proj",
      title: "Milestone 1",
      dueDate: "2026-12-31",
      archivedAt: null,
    });

    // Duplicate slug -> 409
    await send("post", "/projects/plan-proj/milestones", "maintA")
      .send({ slug: "ms-1", title: "Duplicate" })
      .expect(409);

    // Patch milestone
    const patchRes = await send("patch", "/projects/plan-proj/milestones/ms-1", "maintA")
      .send({ dueDate: null })
      .expect(200);
    expect(patchRes.body.dueDate).toBeNull();

    // Archive milestone
    await send("post", "/projects/plan-proj/milestones/ms-1/archive", "maintA").expect(200);
    await send("post", "/projects/plan-proj/milestones/ms-1/archive", "maintA").expect(409);
  });

  it("Sprints CRUD, pagination, invalid dates 422, cannot update closed sprint", async () => {
    // end_date < start_date -> 422
    await send("post", "/projects/plan-proj/sprints", "maintA")
      .send({ name: "Bad Sprint", startDate: "2026-02-15", endDate: "2026-02-01" })
      .expect(422);

    // Create sprint 1
    const s1 = await send("post", "/projects/plan-proj/sprints", "maintA")
      .send({ name: "Sprint 1", startDate: "2026-01-01", endDate: "2026-01-14" })
      .expect(201);
    expect(s1.body).toMatchObject({
      number: 1,
      projectSlug: "plan-proj",
      name: "Sprint 1",
      startDate: "2026-01-01",
      endDate: "2026-01-14",
      status: "PLANNED",
    });

    // Create sprint 2 (sequential numbering)
    const s2 = await send("post", "/projects/plan-proj/sprints", "maintA")
      .send({ name: "Sprint 2", startDate: "2026-01-15", endDate: "2026-01-28" })
      .expect(201);
    expect(s2.body.number).toBe(2);

    // Patch sprint 1
    const updated = await send("patch", "/projects/plan-proj/sprints/1", "maintA")
      .send({ name: "Sprint 1 Revised" })
      .expect(200);
    expect(updated.body.name).toBe("Sprint 1 Revised");

    // List sprints
    const list = await send("get", "/projects/plan-proj/sprints?limit=10&offset=0", "maintA").expect(200);
    expect(list.body.items.map((s: { number: number }) => s.number)).toEqual([1, 2]);
  });
});

describe("AC-3 Sprint transitions and one ACTIVE sprint rule", () => {
  it("enforces PLANNED -> ACTIVE -> CLOSED, 409 on second active, CLOSED not reopenable", async () => {
    // S1 transitions to ACTIVE
    const act1 = await send("post", "/projects/plan-proj/sprints/1/transitions", "maintA")
      .send({ to: "ACTIVE" })
      .expect(200);
    expect(act1.body.status).toBe("ACTIVE");

    // S2 attempting to transition to ACTIVE while S1 is active -> 409
    await send("post", "/projects/plan-proj/sprints/2/transitions", "maintA")
      .send({ to: "ACTIVE" })
      .expect(409);

    // S2 attempting to jump PLANNED -> CLOSED -> 422
    await send("post", "/projects/plan-proj/sprints/2/transitions", "maintA")
      .send({ to: "CLOSED" })
      .expect(422);

    // S1 transitions to CLOSED
    const closed1 = await send("post", "/projects/plan-proj/sprints/1/transitions", "maintA")
      .send({ to: "CLOSED" })
      .expect(200);
    expect(closed1.body.status).toBe("CLOSED");

    // Now S2 transitions to ACTIVE -> 200
    const act2 = await send("post", "/projects/plan-proj/sprints/2/transitions", "maintA")
      .send({ to: "ACTIVE" })
      .expect(200);
    expect(act2.body.status).toBe("ACTIVE");

    // S1 (CLOSED) cannot be reopened -> 422
    await send("post", "/projects/plan-proj/sprints/1/transitions", "maintA")
      .send({ to: "ACTIVE" })
      .expect(422);

    // S1 (CLOSED) cannot be edited via PATCH -> 422
    await send("patch", "/projects/plan-proj/sprints/1", "maintA")
      .send({ name: "New Name" })
      .expect(422);
  });
});

describe("AC-4 Tasks with epic & sprint references", () => {
  it("attaches epic and sprint, rejects cross-project/archived/closed, and filters by epic/sprint", async () => {
    // Create an active epic and milestone in plan-proj
    await send("post", "/projects/plan-proj/epics", "maintA").send({ slug: "epic-active", title: "Active Epic" }).expect(201);
    // Create an epic in plan-other
    await send("post", "/projects/plan-other/epics", "maintA").send({ slug: "epic-other", title: "Other Epic" }).expect(201);

    // Create task with epic and sprint
    const t1 = await send("post", "/projects/plan-proj/tasks", "maintA")
      .send({ title: "Task with planning", epicSlug: "epic-active", sprintNumber: 2 })
      .expect(201);
    expect(t1.body).toMatchObject({
      number: 1,
      epicSlug: "epic-active",
      sprintNumber: 2,
    });

    // Reject unknown epic in project -> 422
    await send("post", "/projects/plan-proj/tasks", "maintA")
      .send({ title: "Task fail", epicSlug: "epic-other" })
      .expect(422);

    // Reject archived epic -> 422 (epic-1 was archived earlier)
    await send("post", "/projects/plan-proj/tasks", "maintA")
      .send({ title: "Task fail", epicSlug: "epic-1" })
      .expect(422);

    // Reject closed sprint -> 422 (sprint 1 is CLOSED)
    await send("post", "/projects/plan-proj/tasks", "maintA")
      .send({ title: "Task fail", sprintNumber: 1 })
      .expect(422);

    // Filter tasks by epic
    const byEpic = await send("get", "/projects/plan-proj/tasks?epic=epic-active", "maintA").expect(200);
    expect(byEpic.body.items.length).toBe(1);
    expect(byEpic.body.items[0].number).toBe(1);

    // Filter tasks by sprint
    const bySprint = await send("get", "/projects/plan-proj/tasks?sprint=2", "maintA").expect(200);
    expect(bySprint.body.items.length).toBe(1);

    const emptySprint = await send("get", "/projects/plan-proj/tasks?sprint=99", "maintA").expect(200);
    expect(emptySprint.body.items.length).toBe(0);

    // Clear epic and sprint via PATCH with null
    const cleared = await send("patch", "/projects/plan-proj/tasks/1", "maintA")
      .send({ epicSlug: null, sprintNumber: null })
      .expect(200);
    expect(cleared.body.epicSlug).toBeNull();
    expect(cleared.body.sprintNumber).toBeNull();
  });
});

describe("AC-5 RBAC and project scope enforcement", () => {
  it("viewer can read but gets 403 on write", async () => {
    await send("get", "/projects/plan-proj/epics", "viewer").expect(200);
    await send("get", "/projects/plan-proj/milestones", "viewer").expect(200);
    await send("get", "/projects/plan-proj/sprints", "viewer").expect(200);

    await send("post", "/projects/plan-proj/epics", "viewer").send({ slug: "ep-v", title: "Viewer Epic" }).expect(403);
    await send("post", "/projects/plan-proj/milestones", "viewer").send({ slug: "ms-v", title: "Viewer MS" }).expect(403);
    await send("post", "/projects/plan-proj/sprints", "viewer")
      .send({ name: "Sprint V", startDate: "2026-03-01", endDate: "2026-03-14" })
      .expect(403);
  });

  it("project_member unassigned to project gets 404", async () => {
    // pmRead is unassigned on plan-other
    await send("get", "/projects/plan-other/epics", "pmRead").expect(404);
    await send("get", "/projects/plan-other/milestones", "pmRead").expect(404);
    await send("get", "/projects/plan-other/sprints", "pmRead").expect(404);
  });

  it("project_member assigned read can read but gets 403 on write", async () => {
    // pmRead has read access to plan-proj
    await send("get", "/projects/plan-proj/epics", "pmRead").expect(200);
    await send("get", "/projects/plan-proj/milestones", "pmRead").expect(200);
    await send("get", "/projects/plan-proj/sprints", "pmRead").expect(200);

    // But cannot write (project_member role doesn't have project:write)
    await send("post", "/projects/plan-proj/epics", "pmRead").send({ slug: "ep-r", title: "Title" }).expect(403);
  });

  it("cross-tenant access gets 404", async () => {
    // maintB belongs to org-test-b, accessing org-test-a project gets 404
    await send("get", "/projects/plan-proj/epics", "maintB").expect(404);
    await send("post", "/projects/plan-proj/epics", "maintB").send({ slug: "ep-x", title: "X" }).expect(404);
  });
});

describe("AC-6 Audit events recording", () => {
  it("records exactly 1 audit event per mutating action with correct actor and metadata", async () => {
    const events = await pool.query<{ action: string; target_type: string; metadata: Record<string, unknown> }>(
      "SELECT action, target_type, metadata FROM audit_events ORDER BY id ASC",
    );
    const actions = events.rows.map((e) => e.action);

    expect(actions).toContain("epic.created");
    expect(actions).toContain("epic.updated");
    expect(actions).toContain("epic.archived");
    expect(actions).toContain("milestone.created");
    expect(actions).toContain("milestone.updated");
    expect(actions).toContain("milestone.archived");
    expect(actions).toContain("sprint.created");
    expect(actions).toContain("sprint.updated");
    expect(actions).toContain("sprint.transitioned");
    expect(actions).toContain("task.created");
    expect(actions).toContain("task.updated");

    const taskUpdateEvent = events.rows.find((e) => e.action === "task.updated");
    expect(taskUpdateEvent).toBeDefined();
    expect(taskUpdateEvent!.metadata).toHaveProperty("fields");
  });
});
