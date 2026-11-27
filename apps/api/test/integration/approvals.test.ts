import type { INestApplication } from "@nestjs/common";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { createPool, grantRole, migrateUp, seed, type Pool } from "@aidevteam/db";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApprovalsController } from "../../src/approvals/approvals.controller";
import type { GithubOAuthClient } from "../../src/auth/github-client";
import { createApp } from "../../src/bootstrap";
import { SESSION_COOKIE } from "../../src/cookies";
import { testConfig } from "../helpers";

const noGithub: GithubOAuthClient = {
  exchangeCodeForIdentity: async () => {
    throw new Error("not used");
  },
};

const CONFIGURED_REPO = "aidev-org/aidev-repo";

let pool: Pool;
let app: INestApplication;
const tokens: Record<string, string> = {};

let orgAId: string;
let orgBId: string;

let approvalA1Id: string;
let approvalA2Id: string;
let approvalB1Id: string;
let approvalDiffRepoId: string;

async function sessionFor(githubUserId: number, activeOrgSlug?: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  let activeOrgId: string | null = null;
  if (activeOrgSlug) {
    const r = await pool.query<{ id: string }>("SELECT id FROM orgs WHERE slug = $1", [activeOrgSlug]);
    activeOrgId = r.rows[0]?.id ?? null;
  }
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, active_org_id)
     SELECT id, $2, now() + interval '1 hour', $3 FROM users WHERE github_user_id = $1`,
    [githubUserId, createHash("sha256").update(token).digest(), activeOrgId],
  );
  return token;
}

const as = (who: string) => `${SESSION_COOKIE}=${tokens[who]}`;
const api = () => request(app.getHttpServer());

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

  const orgRes = await pool.query<{ id: string; slug: string }>("SELECT id, slug FROM orgs");
  orgAId = orgRes.rows.find((r) => r.slug === "org-test-a")!.id;
  orgBId = orgRes.rows.find((r) => r.slug === "org-test-b")!.id;

  // Additional fake test users
  for (const id of [900000010, 900000011, 900000012, 900000013, 900000014]) {
    await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake-approval-test')", [id]);
    await pool.query(
      "INSERT INTO users (github_user_id, github_login) VALUES ($1, $2) ON CONFLICT (github_user_id) DO NOTHING",
      [id, `user-${id}`],
    );
  }

  // Roles in org-test-a
  await grantRole(pool, 900000010, "org-test-a", "viewer");
  await grantRole(pool, 900000011, "org-test-a", "maintainer");
  await grantRole(pool, 900000012, "org-test-a", "org_admin");
  // 900000013 has role only in org-test-b
  await grantRole(pool, 900000013, "org-test-b", "viewer");
  // 900000014 has no role in any org

  tokens.viewerA = await sessionFor(900000010, "org-test-a");
  tokens.maintA = await sessionFor(900000011, "org-test-a");
  tokens.adminA = await sessionFor(900000012, "org-test-a");
  tokens.userBOnly = await sessionFor(900000013, "org-test-b");
  tokens.noRole = await sessionFor(900000014);

  // Insert seed approvals
  // 1. In Org A: uat, approved, matching configured repo
  const insA1 = await pool.query<{ id: string }>(
    `INSERT INTO release_approvals (
       org_id, environment, decision, target_sha, release_manifest_digest,
       pipeline_run_id, approver_github_user_id, source_comment_url, decided_at
     ) VALUES (
       $1, 'uat', 'approved', '0123456789abcdef0123456789abcdef01234567',
       'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
       'TEST-run-001', 900000099, 'https://github.com/${CONFIGURED_REPO}/pull/10#issuecomment-1001',
       '2026-11-27T10:00:00.000Z'
     ) RETURNING id`,
    [orgAId],
  );
  approvalA1Id = insA1.rows[0]!.id;

  // 2. In Org A: production, rejected, matching configured repo, later decided_at
  const insA2 = await pool.query<{ id: string }>(
    `INSERT INTO release_approvals (
       org_id, environment, decision, target_sha, release_manifest_digest,
       pipeline_run_id, approver_github_user_id, source_comment_url, decided_at
     ) VALUES (
       $1, 'production', 'rejected', '0123456789abcdef0123456789abcdef01234568',
       'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
       'TEST-run-002', 900000099, 'https://github.com/${CONFIGURED_REPO}/pull/11#issuecomment-1002',
       '2026-11-27T11:00:00.000Z'
     ) RETURNING id`,
    [orgAId],
  );
  approvalA2Id = insA2.rows[0]!.id;

  // 3. In Org A: different repo URL
  const insDiffRepo = await pool.query<{ id: string }>(
    `INSERT INTO release_approvals (
       org_id, environment, decision, target_sha, release_manifest_digest,
       pipeline_run_id, approver_github_user_id, source_comment_url, decided_at
     ) VALUES (
       $1, 'uat', 'approved', '0123456789abcdef0123456789abcdef01234569',
       'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
       'TEST-run-003', 900000099, 'https://github.com/different-org/different-repo/pull/12#issuecomment-1003',
       '2026-11-27T09:00:00.000Z'
     ) RETURNING id`,
    [orgAId],
  );
  approvalDiffRepoId = insDiffRepo.rows[0]!.id;

  // 4. In Org B: uat, approved
  const insB1 = await pool.query<{ id: string }>(
    `INSERT INTO release_approvals (
       org_id, environment, decision, target_sha, release_manifest_digest,
       pipeline_run_id, approver_github_user_id, source_comment_url, decided_at
     ) VALUES (
       $1, 'uat', 'approved', '0123456789abcdef0123456789abcdef01234570',
       'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
       'TEST-run-004', 900000099, 'https://github.com/${CONFIGURED_REPO}/pull/20#issuecomment-2001',
       '2026-11-27T12:00:00.000Z'
     ) RETURNING id`,
    [orgBId],
  );
  approvalB1Id = insB1.rows[0]!.id;

  app = await createApp({
    config: testConfig({ approvalRepo: CONFIGURED_REPO }),
    pool,
    githubClient: noGithub,
  });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe("AC-1 Read-only controller & route inspection", () => {
  it("proves ApprovalsController only exposes GET methods via NestJS reflection", () => {
    const controllerPath = Reflect.getMetadata(PATH_METADATA, ApprovalsController);
    expect(controllerPath).toBe("approvals");

    const prototype = ApprovalsController.prototype as unknown as Record<string, unknown>;
    const propertyNames = Object.getOwnPropertyNames(prototype).filter((p) => p !== "constructor");

    expect(propertyNames.length).toBeGreaterThan(0);
    for (const prop of propertyNames) {
      const fn = prototype[prop];
      if (typeof fn === "function") {
        const methodMetadata = Reflect.getMetadata(METHOD_METADATA, fn);
        // RequestMethod.GET is 0 in NestJS
        expect(methodMetadata).toBe(RequestMethod.GET);
      }
    }
  });

  it("proves Express router has only GET routes for /approvals", () => {
    interface ExpressLayer {
      route?: {
        path: string;
        methods: Record<string, boolean>;
      };
    }
    interface ExpressAppLike {
      router?: { stack?: ExpressLayer[] };
      _router?: { stack?: ExpressLayer[] };
    }
    const expressApp = app.getHttpAdapter().getInstance() as ExpressAppLike;
    const server = app.getHttpServer() as { _events?: { request?: ExpressAppLike } };
    const router = expressApp.router ?? expressApp._router ?? server._events?.request?.router ?? server._events?.request?._router;

    expect(router).toBeDefined();
    expect(router?.stack).toBeDefined();

    const approvalRoutes: Array<{ path: string; methods: string[] }> = [];

    for (const layer of router?.stack ?? []) {
      if (layer.route && typeof layer.route.path === "string" && layer.route.path.startsWith("/approvals")) {
        approvalRoutes.push({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        });
      }
    }

    expect(approvalRoutes.length).toBeGreaterThan(0);
    for (const route of approvalRoutes) {
      expect(route.methods).toEqual(["get"]);
    }
  });

  it.each(["post", "patch", "delete", "put"] as const)(
    "returns 404 for %s /approvals and %s /approvals/:id",
    async (method) => {
      await api()[method]("/approvals").set("Cookie", as("maintA")).expect(404);
      await api()[method](`/approvals/${approvalA1Id}`).set("Cookie", as("maintA")).expect(404);
    },
  );
});

describe("AC-3 Safe comment URL and APPROVAL_REPO integration", () => {
  it("shows sourceCommentUrl when APPROVAL_REPO matches the record URL", async () => {
    const res = await api().get(`/approvals/${approvalA1Id}`).set("Cookie", as("viewerA")).expect(200);
    expect(res.body.sourceCommentUrl).toBe(`https://github.com/${CONFIGURED_REPO}/pull/10#issuecomment-1001`);
  });

  it("sets sourceCommentUrl to null when the record URL repo does not match APPROVAL_REPO", async () => {
    const res = await api().get(`/approvals/${approvalDiffRepoId}`).set("Cookie", as("viewerA")).expect(200);
    expect(res.body.sourceCommentUrl).toBeNull();
  });
});

describe("AC-4 Org scoping, RBAC and query parameters", () => {
  it("strictly scopes approvals to the session's active org in list and get", async () => {
    // Org A listing should include A1, A2, diffRepo, but NOT B1
    const resA = await api().get("/approvals").set("Cookie", as("maintA")).expect(200);
    const idsA = resA.body.items.map((i: { id: string }) => i.id);
    expect(idsA).toContain(approvalA1Id);
    expect(idsA).toContain(approvalA2Id);
    expect(idsA).toContain(approvalDiffRepoId);
    expect(idsA).not.toContain(approvalB1Id);

    // User in Org A querying Org B's approval returns 404
    await api().get(`/approvals/${approvalB1Id}`).set("Cookie", as("maintA")).expect(404);

    // User in Org B querying Org B's approval gets 200
    const resB = await api().get(`/approvals/${approvalB1Id}`).set("Cookie", as("userBOnly")).expect(200);
    expect(resB.body.id).toBe(approvalB1Id);
  });

  it("returns 404 approval_not_found for non-UUID id", async () => {
    const res = await api().get("/approvals/not-a-valid-uuid").set("Cookie", as("viewerA")).expect(404);
    expect(res.body.message).toBe("approval_not_found");
  });

  it("enforces authentication and RBAC permissions", async () => {
    // No session -> 401
    await api().get("/approvals").expect(401);
    await api().get(`/approvals/${approvalA1Id}`).expect(401);

    // User without role in active org -> 403
    await api().get("/approvals").set("Cookie", as("noRole")).expect(403);
    await api().get(`/approvals/${approvalA1Id}`).set("Cookie", as("noRole")).expect(403);

    // Viewer, maintainer, org_admin all have approval:read -> 200
    await api().get("/approvals").set("Cookie", as("viewerA")).expect(200);
    await api().get("/approvals").set("Cookie", as("maintA")).expect(200);
    await api().get("/approvals").set("Cookie", as("adminA")).expect(200);
  });

  it("filters by environment and orders by decided_at DESC, id DESC", async () => {
    const resUat = await api().get("/approvals?environment=uat").set("Cookie", as("viewerA")).expect(200);
    expect(resUat.body.items.every((i: { environment: string }) => i.environment === "uat")).toBe(true);
    expect(resUat.body.items.some((i: { id: string }) => i.id === approvalA1Id)).toBe(true);
    expect(resUat.body.items.some((i: { id: string }) => i.id === approvalA2Id)).toBe(false);

    const resProd = await api().get("/approvals?environment=production").set("Cookie", as("viewerA")).expect(200);
    expect(resProd.body.items.every((i: { environment: string }) => i.environment === "production")).toBe(true);
    expect(resProd.body.items.some((i: { id: string }) => i.id === approvalA2Id)).toBe(true);

    // Sorting check: A2 (decided at 11:00) should appear before A1 (decided at 10:00)
    const resAll = await api().get("/approvals").set("Cookie", as("viewerA")).expect(200);
    const ids = resAll.body.items.map((i: { id: string }) => i.id);
    expect(ids.indexOf(approvalA2Id)).toBeLessThan(ids.indexOf(approvalA1Id));
  });

  it("handles pagination (limit and offset) and rejects invalid query values with 422", async () => {
    const resPaged = await api().get("/approvals?limit=1&offset=1").set("Cookie", as("viewerA")).expect(200);
    expect(resPaged.body.limit).toBe(1);
    expect(resPaged.body.offset).toBe(1);
    expect(resPaged.body.items.length).toBe(1);

    await api().get("/approvals?limit=0").set("Cookie", as("viewerA")).expect(422);
    await api().get("/approvals?limit=101").set("Cookie", as("viewerA")).expect(422);
    await api().get("/approvals?offset=-1").set("Cookie", as("viewerA")).expect(422);
    await api().get("/approvals?environment=invalid").set("Cookie", as("viewerA")).expect(422);
  });
});
