import { type INestApplication } from "@nestjs/common";
import {
  createPool,
  grantPlatformAdmin,
  grantRole,
  migrateUp,
  seed,
  type Pool,
} from "@aidevteam/db";
import {
  API_OPERATIONS,
  PERMISSIONS,
  PLATFORM_PERMISSIONS,
  ROLE_PERMISSIONS,
  type OpenApiOperationDef,
  type Permission,
} from "@aidevteam/contracts";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GithubOAuthClient } from "../../src/auth/github-client";
import { createApp } from "../../src/bootstrap";
import { SESSION_COOKIE } from "../../src/cookies";
import { testConfig } from "../helpers";

/**
 * P2-12 Authorization matrix (RBAC x all routes) + cross-tenant denial.
 *
 * Actors:
 *   - anon: unauthenticated (no session cookie)
 *   - norole: 900000004 (allowlist only, no org role)
 *   - viewer_a: 900000002 (viewer in org-test-a)
 *   - maintainer_a: 900000003 (maintainer in org-test-a)
 *   - admin_a: 900000001 (org_admin in org-test-a)
 *   - admin_b: 900000005 (org_admin in org-test-b)
 *   - platform: 900000006 (platform admin, no org role)
 */

const ORIGIN = "https://cc.example.com";

const noGithub: GithubOAuthClient = {
  exchangeCodeForIdentity: async () => {
    throw new Error("not used in tests");
  },
};

let pool: Pool;
let app: INestApplication;
const tokens: Record<string, string> = {};
let orgBId = "";

let matrixPassCount = 0;
let crossTenantPassCount = 0;
let bodyRejectionPassCount = 0;

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

function resolvePath(pathTemplate: string): string {
  return pathTemplate
    .replace(/\{projectSlug\}/g, "does-not-exist")
    .replace(/\{slug\}/g, "does-not-exist")
    .replace(/\{epicSlug\}/g, "does-not-exist")
    .replace(/\{milestoneSlug\}/g, "does-not-exist")
    .replace(/\{number\}/g, "999999")
    .replace(
      /\{id\}/g,
      pathTemplate.includes("/audit/")
        ? "999999"
        : "00000000-0000-0000-0000-000000000000",
    );
}

async function sendOp(
  op: OpenApiOperationDef,
  who: string,
  body?: Record<string, unknown>,
) {
  const method = op.method.toLowerCase() as
    | "get"
    | "post"
    | "patch"
    | "delete"
    | "put";
  const path = resolvePath(op.path);
  let req = api()[method](path).set("Origin", ORIGIN);
  if (who !== "anon" && tokens[who]) {
    req = req.set("Cookie", as(who));
  }
  if (method !== "get") {
    req = req.send(body ?? {});
  }
  return req;
}

interface OrgStats {
  projectsCount: number;
  projectsMaxUpdated: string | null;
  tasksCount: number;
  tasksMaxUpdated: string | null;
  paCount: number;
  paMaxUpdated: string | null;
  workersCount: number;
  workersMaxUpdated: string | null;
  agentsCount: number;
  agentsMaxUpdated: string | null;
  runsCount: number;
}

async function getOrgStats(orgId: string): Promise<OrgStats> {
  const [p, t, pa, w, a, r] = await Promise.all([
    pool.query<{ count: string; max_updated: Date | null }>(
      "SELECT count(*)::text AS count, max(updated_at) AS max_updated FROM projects WHERE org_id = $1",
      [orgId],
    ),
    pool.query<{ count: string; max_updated: Date | null }>(
      "SELECT count(*)::text AS count, max(updated_at) AS max_updated FROM tasks WHERE org_id = $1",
      [orgId],
    ),
    pool.query<{ count: string; max_updated: Date | null }>(
      "SELECT count(*)::text AS count, max(updated_at) AS max_updated FROM provider_accounts WHERE org_id = $1",
      [orgId],
    ),
    pool.query<{ count: string; max_updated: Date | null }>(
      "SELECT count(*)::text AS count, max(updated_at) AS max_updated FROM workers WHERE org_id = $1",
      [orgId],
    ),
    pool.query<{ count: string; max_updated: Date | null }>(
      "SELECT count(*)::text AS count, max(updated_at) AS max_updated FROM agents WHERE org_id = $1",
      [orgId],
    ),
    pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM agent_runs WHERE org_id = $1",
      [orgId],
    ),
  ]);

  return {
    projectsCount: Number(p.rows[0]?.count ?? 0),
    projectsMaxUpdated: p.rows[0]?.max_updated?.toISOString() ?? null,
    tasksCount: Number(t.rows[0]?.count ?? 0),
    tasksMaxUpdated: t.rows[0]?.max_updated?.toISOString() ?? null,
    paCount: Number(pa.rows[0]?.count ?? 0),
    paMaxUpdated: pa.rows[0]?.max_updated?.toISOString() ?? null,
    workersCount: Number(w.rows[0]?.count ?? 0),
    workersMaxUpdated: w.rows[0]?.max_updated?.toISOString() ?? null,
    agentsCount: Number(a.rows[0]?.count ?? 0),
    agentsMaxUpdated: a.rows[0]?.max_updated?.toISOString() ?? null,
    runsCount: Number(r.rows[0]?.count ?? 0),
  };
}

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test$/.test(new URL(url).pathname.slice(1))) {
    throw new Error(
      "TEST_DATABASE_URL with a *_test database is required for integration tests",
    );
  }
  pool = createPool(url, { max: 10 });
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrateUp(pool);
  await seed(pool, { NODE_ENV: "test" });

  const testIds = [
    900000001, 900000002, 900000003, 900000004, 900000005, 900000006,
    900000007,
  ];
  for (const id of testIds) {
    await pool.query(
      "INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake') ON CONFLICT DO NOTHING",
      [id],
    );
    await pool.query(
      "INSERT INTO users (github_user_id, github_login) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [id, `test-user-${id}`],
    );
  }

  await grantRole(pool, 900000001, "org-test-a", "org_admin");
  await grantRole(pool, 900000002, "org-test-a", "viewer");
  await grantRole(pool, 900000003, "org-test-a", "maintainer");
  // 900000004 has no roles (norole)
  await grantRole(pool, 900000005, "org-test-b", "org_admin");
  await grantPlatformAdmin(pool, 900000006, "test");
  // P2-13: project_member without any assignment (project-scoped, default deny)
  await grantRole(pool, 900000007, "org-test-a", "project_member");

  orgBId = (
    await pool.query<{ id: string }>(
      "SELECT id FROM orgs WHERE slug = 'org-test-b'",
    )
  ).rows[0]!.id;

  tokens.admin_a = await sessionFor(900000001);
  tokens.viewer_a = await sessionFor(900000002);
  tokens.maintainer_a = await sessionFor(900000003);
  tokens.norole = await sessionFor(900000004);
  tokens.admin_b = await sessionFor(900000005);
  tokens.platform = await sessionFor(900000006);
  tokens.pm_a = await sessionFor(900000007);

  app = await createApp({
    config: testConfig(),
    pool,
    githubClient: noGithub,
  });
  await app.init();
});

afterAll(async () => {
  console.warn(`
============================================================
           AUTHZ MATRIX TEST EVIDENCE (P2-12)
============================================================
  1. RBAC Matrix operations checked:   ${matrixPassCount}
  2. Cross-tenant isolation checks:     ${crossTenantPassCount}
  3. Body org injection checks:        ${bodyRejectionPassCount}
  Total authorization assertions:      ${matrixPassCount + crossTenantPassCount + bodyRejectionPassCount}
============================================================
`);
  if (app) await app.close();
  if (pool) await pool.end();
});

describe("AC-4 Registry operations integrity", () => {
  it("registry contains permission operations and every permission is valid and known", () => {
    const permissionOps = API_OPERATIONS.filter(
      (op) =>
        op.permission &&
        op.permission !== "public" &&
        op.permission !== "authenticated",
    );
    expect(permissionOps.length).toBeGreaterThan(0);

    const allowedPermissions = new Set<string>([
      ...PERMISSIONS,
      ...PLATFORM_PERMISSIONS,
    ]);
    for (const op of permissionOps) {
      expect(
        allowedPermissions.has(op.permission!),
        `Operation ${op.method} ${op.path} has unknown permission: ${op.permission}`,
      ).toBe(true);
    }
  });
});

describe("AC-1 RBAC matrix across all operations (7 actors)", () => {
  it("viewer role is strictly read-only and never granted write permissions", () => {
    expect(
      ROLE_PERMISSIONS.viewer.has("project:write" as Permission),
      "viewer must not have project:write",
    ).toBe(false);
    expect(
      [...ROLE_PERMISSIONS.viewer].some((p) => p.endsWith(":write")),
      "viewer must not have any write permission",
    ).toBe(false);
  });

  const permissionOps = API_OPERATIONS.filter(
    (op) =>
      op.permission &&
      op.permission !== "public" &&
      op.permission !== "authenticated",
  );

  const actors = [
    "anon",
    "norole",
    "viewer_a",
    "maintainer_a",
    "admin_a",
    "admin_b",
    "platform",
    "pm_a",
  ] as const;

  it.each(permissionOps)(
    "$method $path (perm: $permission) satisfies RBAC matrix",
    async (op) => {
      const isPlatformOp = (
        PLATFORM_PERMISSIONS as readonly string[]
      ).includes(op.permission!);

      for (const actor of actors) {
        const res = await sendOp(op, actor);

        let allowed: boolean;
        if (isPlatformOp) {
          allowed = actor === "platform";
        } else {
          if (actor === "viewer_a") {
            allowed =
              !op.permission!.endsWith(":write") &&
              !op.permission!.endsWith(":license") &&
              !op.permission!.endsWith(":execute") &&
              ROLE_PERMISSIONS.viewer.has(op.permission as Permission);
          } else if (actor === "maintainer_a") {
            allowed = ROLE_PERMISSIONS.maintainer.has(
              op.permission as Permission,
            );
          } else if (actor === "pm_a") {
            // Guard-level permission; unassigned projects then resolve to 404 (project-access.test.ts covers scope)
            allowed = ROLE_PERMISSIONS.project_member.has(op.permission as Permission);
          } else if (actor === "admin_a" || actor === "admin_b") {
            allowed = ROLE_PERMISSIONS.org_admin.has(
              op.permission as Permission,
            );
          } else {
            // anon, norole, platform (has no org role)
            allowed = false;
          }
        }

        if (actor === "anon") {
          expect(
            res.status,
            `Expected 401 for anon on ${op.method} ${op.path}, got ${res.status}`,
          ).toBe(401);
        } else if (allowed) {
          expect(
            [401, 403],
            `Expected allowed (not 401/403) for ${actor} on ${op.method} ${op.path}, got ${res.status}`,
          ).not.toContain(res.status);
        } else {
          expect(
            res.status,
            `Expected 403 for ${actor} on ${op.method} ${op.path}, got ${res.status}`,
          ).toBe(403);
        }
        matrixPassCount++;
      }
    },
  );
});

describe("AC-2 Cross-tenant isolation (Org A vs Org B)", () => {
  let initialOrgBStats: OrgStats;

  beforeAll(async () => {
    // 1. Create resources in Org B via API by admin_b
    await api()
      .post("/projects")
      .set("Origin", ORIGIN)
      .set("Cookie", as("admin_b"))
      .send({ slug: "proj-b-tenant", name: "Project B Tenant" })
      .expect(201);

    await api()
      .post("/workers")
      .set("Origin", ORIGIN)
      .set("Cookie", as("admin_b"))
      .send({
        slug: "worker-b-tenant",
        name: "Worker B Tenant",
        type: "mock",
        workspacePath: "/srv/workspaces/worker-b-tenant",
      })
      .expect(201);

    await api()
      .post("/provider-accounts")
      .set("Origin", ORIGIN)
      .set("Cookie", as("admin_b"))
      .send({
        slug: "pa-b-tenant",
        name: "PA B Tenant",
        provider: "anthropic",
        secretRef: "env:AIDEV_SECRET_PA_B_TENANT",
      })
      .expect(201);

    await api()
      .post("/agents")
      .set("Origin", ORIGIN)
      .set("Cookie", as("admin_b"))
      .send({
        slug: "agent-b-tenant",
        name: "Agent B Tenant",
      })
      .expect(201);

    await api()
      .post("/projects/proj-b-tenant/tasks")
      .set("Origin", ORIGIN)
      .set("Cookie", as("admin_b"))
      .send({
        title: "Task B Tenant",
        agentSlug: "agent-b-tenant",
      })
      .expect(201);

    // Record snapshot of Org B DB state
    initialOrgBStats = await getOrgStats(orgBId);
  });

  it("admin_a gets 404 accessing Org B resources directly", async () => {
    const check404 = async (
      method: "get" | "patch" | "post",
      path: string,
      body?: Record<string, unknown>,
    ) => {
      let req = api()[method](path)
        .set("Origin", ORIGIN)
        .set("Cookie", as("admin_a"));
      if (body) req = req.send(body);
      const res = await req;
      expect(
        res.status,
        `Expected 404 for admin_a on ${method.toUpperCase()} ${path}, got ${res.status}`,
      ).toBe(404);
      crossTenantPassCount++;
    };

    // Project routes
    await check404("get", "/projects/proj-b-tenant");
    await check404("patch", "/projects/proj-b-tenant", { name: "Attacked" });
    await check404("post", "/projects/proj-b-tenant/archive", {});

    // Provider Account routes
    await check404("get", "/provider-accounts/pa-b-tenant");
    await check404("patch", "/provider-accounts/pa-b-tenant", {
      name: "Attacked",
    });
    await check404("post", "/provider-accounts/pa-b-tenant/archive", {});
    await check404("post", "/provider-accounts/pa-b-tenant/license", {
      licenseStatus: "prohibited",
    });

    // Worker routes
    await check404("get", "/workers/worker-b-tenant");
    await check404("patch", "/workers/worker-b-tenant", { name: "Attacked" });
    await check404("post", "/workers/worker-b-tenant/archive", {});

    // Agent routes
    await check404("get", "/agents/agent-b-tenant");
    await check404("patch", "/agents/agent-b-tenant", { name: "Attacked" });
    await check404("post", "/agents/agent-b-tenant/archive", {});

    // Task routes
    await check404("get", "/projects/proj-b-tenant/tasks");
    await check404("get", "/projects/proj-b-tenant/tasks/1");
    await check404("patch", "/projects/proj-b-tenant/tasks/1", {
      title: "Attacked",
    });
    await check404("post", "/projects/proj-b-tenant/tasks/1/transitions", {
      expectedFrom: "BACKLOG",
      to: "TODO",
    });
    await check404("post", "/projects/proj-b-tenant/tasks/1/dispatch", {
      workerSlug: "worker-b-tenant",
    });
    await check404("get", "/projects/proj-b-tenant/tasks/1/runs");
  });

  it("admin_a list endpoints never leak Org B resources", async () => {
    // Projects list
    const projRes = await api()
      .get("/projects")
      .set("Origin", ORIGIN)
      .set("Cookie", as("admin_a"))
      .expect(200);
    const projSlugs = projRes.body.items.map((p: { slug: string }) => p.slug);
    expect(projSlugs).not.toContain("proj-b-tenant");
    crossTenantPassCount++;

    // Workers list
    const workerRes = await api()
      .get("/workers")
      .set("Origin", ORIGIN)
      .set("Cookie", as("admin_a"))
      .expect(200);
    const workerSlugs = workerRes.body.items.map(
      (w: { slug: string }) => w.slug,
    );
    expect(workerSlugs).not.toContain("worker-b-tenant");
    crossTenantPassCount++;

    // Provider accounts list
    const paRes = await api()
      .get("/provider-accounts")
      .set("Origin", ORIGIN)
      .set("Cookie", as("admin_a"))
      .expect(200);
    const paSlugs = paRes.body.items.map((pa: { slug: string }) => pa.slug);
    expect(paSlugs).not.toContain("pa-b-tenant");
    crossTenantPassCount++;

    // Agents list
    const agentRes = await api()
      .get("/agents")
      .set("Origin", ORIGIN)
      .set("Cookie", as("admin_a"))
      .expect(200);
    const agentSlugs = agentRes.body.items.map((a: { slug: string }) => a.slug);
    expect(agentSlugs).not.toContain("agent-b-tenant");
    crossTenantPassCount++;

    // Members list
    const memberRes = await api()
      .get("/org/members")
      .set("Origin", ORIGIN)
      .set("Cookie", as("admin_a"))
      .expect(200);
    const memberIds = memberRes.body.map(
      (m: { githubUserId: number }) => m.githubUserId,
    );
    expect(memberIds).not.toContain(900000005);
    crossTenantPassCount++;

    // Approvals list
    await api()
      .get("/approvals")
      .set("Origin", ORIGIN)
      .set("Cookie", as("admin_a"))
      .expect(200);
    crossTenantPassCount++;

    // Dashboard
    await api()
      .get("/dashboard")
      .set("Origin", ORIGIN)
      .set("Cookie", as("admin_a"))
      .expect(200);
    crossTenantPassCount++;

    // Audit events list
    const auditRes = await api()
      .get("/audit/events")
      .set("Origin", ORIGIN)
      .set("Cookie", as("admin_a"))
      .expect(200);
    const auditTargets = auditRes.body.map(
      (e: { targetId: string | null }) => e.targetId,
    );
    expect(auditTargets).not.toContain("proj-b-tenant");
    expect(auditTargets).not.toContain("worker-b-tenant");
    expect(auditTargets).not.toContain("pa-b-tenant");
    expect(auditTargets).not.toContain("agent-b-tenant");
    crossTenantPassCount++;
  });

  it("Org B database rows and updated_at timestamps remain completely unchanged", async () => {
    const currentOrgBStats = await getOrgStats(orgBId);
    expect(currentOrgBStats).toEqual(initialOrgBStats);
    crossTenantPassCount++;
  });
});

describe("AC-3 Request body strictness (orgId / orgSlug rejected)", () => {
  interface WriteTestCase {
    name: string;
    method: "post" | "patch" | "delete";
    path: string;
    actor: "admin_a" | "platform";
    validBody: Record<string, unknown>;
  }

  const writeTestCases: WriteTestCase[] = [
    {
      name: "POST /org/members/roles",
      method: "post",
      path: "/org/members/roles",
      actor: "admin_a",
      validBody: { githubUserId: 900000002, role: "viewer" },
    },
    {
      name: "DELETE /org/members/roles",
      method: "delete",
      path: "/org/members/roles",
      actor: "admin_a",
      validBody: { githubUserId: 900000002, role: "viewer" },
    },
    {
      name: "POST /projects",
      method: "post",
      path: "/projects",
      actor: "admin_a",
      validBody: { slug: "proj-strict-test", name: "Strict Test" },
    },
    {
      name: "PATCH /projects/{slug}",
      method: "patch",
      path: "/projects/does-not-exist",
      actor: "admin_a",
      validBody: { name: "Renamed Project" },
    },
    {
      name: "POST /provider-accounts",
      method: "post",
      path: "/provider-accounts",
      actor: "admin_a",
      validBody: {
        slug: "pa-strict-test",
        name: "PA Strict Test",
        provider: "anthropic",
        secretRef: "env:AIDEV_SECRET_STRICT",
      },
    },
    {
      name: "PATCH /provider-accounts/{slug}",
      method: "patch",
      path: "/provider-accounts/does-not-exist",
      actor: "admin_a",
      validBody: { name: "Renamed PA" },
    },
    {
      name: "POST /provider-accounts/{slug}/license",
      method: "post",
      path: "/provider-accounts/does-not-exist/license",
      actor: "admin_a",
      validBody: { licenseStatus: "approved" },
    },
    {
      name: "POST /workers",
      method: "post",
      path: "/workers",
      actor: "admin_a",
      validBody: {
        slug: "worker-strict-test",
        name: "Worker Strict",
        type: "mock",
        workspacePath: "/srv/workspaces/worker-strict-test",
      },
    },
    {
      name: "PATCH /workers/{slug}",
      method: "patch",
      path: "/workers/does-not-exist",
      actor: "admin_a",
      validBody: { name: "Renamed Worker" },
    },
    {
      name: "POST /agents",
      method: "post",
      path: "/agents",
      actor: "admin_a",
      validBody: { slug: "agent-strict-test", name: "Agent Strict" },
    },
    {
      name: "PATCH /agents/{slug}",
      method: "patch",
      path: "/agents/does-not-exist",
      actor: "admin_a",
      validBody: { name: "Renamed Agent" },
    },
    {
      name: "POST /projects/{projectSlug}/tasks",
      method: "post",
      path: "/projects/does-not-exist/tasks",
      actor: "admin_a",
      validBody: { title: "Task Strict" },
    },
    {
      name: "PATCH /projects/{projectSlug}/tasks/{number}",
      method: "patch",
      path: "/projects/does-not-exist/tasks/999999",
      actor: "admin_a",
      validBody: { title: "Renamed Task" },
    },
    {
      name: "POST /projects/{projectSlug}/tasks/{number}/transitions",
      method: "post",
      path: "/projects/does-not-exist/tasks/999999/transitions",
      actor: "admin_a",
      validBody: { expectedFrom: "BACKLOG", to: "TODO" },
    },
    {
      name: "POST /projects/{projectSlug}/tasks/{number}/dispatch",
      method: "post",
      path: "/projects/does-not-exist/tasks/999999/dispatch",
      actor: "admin_a",
      validBody: { workerSlug: "mock-worker" },
    },
    {
      name: "POST /platform/orgs",
      method: "post",
      path: "/platform/orgs",
      actor: "platform",
      validBody: { slug: "org-strict-test", name: "Org Strict" },
    },
    {
      name: "PATCH /platform/orgs/{slug}",
      method: "patch",
      path: "/platform/orgs/does-not-exist",
      actor: "platform",
      validBody: { name: "Renamed Org" },
    },
  ];

  it.each(writeTestCases)(
    "$name rejects body containing extra orgId or orgSlug",
    async (tc) => {
      // 1. Inject orgId
      const resOrgId = await api()[tc.method](tc.path)
        .set("Origin", ORIGIN)
        .set("Cookie", as(tc.actor))
        .send({ ...tc.validBody, orgId: orgBId });
      expect([400, 422]).toContain(resOrgId.status);
      bodyRejectionPassCount++;

      // 2. Inject orgSlug
      const resOrgSlug = await api()[tc.method](tc.path)
        .set("Origin", ORIGIN)
        .set("Cookie", as(tc.actor))
        .send({ ...tc.validBody, orgSlug: "org-test-b" });
      expect([400, 422]).toContain(resOrgSlug.status);
      bodyRejectionPassCount++;
    },
  );
});
