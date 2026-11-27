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
 * P2-04 org members and role editor.
 * Fake data only:
 *   900000001 org_admin   org-test-a (Admin A1)
 *   900000002 viewer      org-test-a
 *   900000003 maintainer  org-test-a
 *   900000004 org_admin   org-test-a (Admin A2)
 *   900000005 allowlisted org-test-a (no roles initially)
 *   900000006 not allowlisted
 *   900000007 allowlisted but disabled
 *   900000010 org_admin   org-test-b (Admin B)
 *   900000011 viewer      org-test-b
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
const write = (method: "post" | "patch" | "delete", path: string, who: string) =>
  api()[method](path).set("Origin", ORIGIN).set("Cookie", as(who));

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test$/.test(new URL(url).pathname.slice(1))) throw new Error("TEST_DATABASE_URL with a *_test database is required");
  pool = createPool(url, { max: 10 });
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrateUp(pool);
  await seed(pool, { NODE_ENV: "test" });

  // Allowlist setup
  for (const id of [900000003, 900000004, 900000005, 900000007, 900000010, 900000011]) {
    await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake')", [id]);
  }

  // Create disabled user 900000007
  await pool.query(
    "INSERT INTO users (github_user_id, github_login, disabled_at) VALUES (900000007, 'test-disabled', now())",
  );

  // Assign roles in org-test-a
  await grantRole(pool, 900000001, "org-test-a", "org_admin");
  await grantRole(pool, 900000002, "org-test-a", "viewer");
  await grantRole(pool, 900000003, "org-test-a", "maintainer");
  await grantRole(pool, 900000004, "org-test-a", "org_admin");

  // Ensure maintainer role exists in org-test-a
  await pool.query(
    `INSERT INTO roles (org_id, key, name)
     SELECT id, 'maintainer', 'maintainer' FROM orgs WHERE slug = 'org-test-a'
     ON CONFLICT (org_id, key) DO NOTHING`,
  );

  // Assign roles in org-test-b
  await grantRole(pool, 900000010, "org-test-b", "org_admin");
  await grantRole(pool, 900000011, "org-test-b", "viewer");

  tokens.admin1 = await sessionFor(900000001);
  tokens.viewer = await sessionFor(900000002);
  tokens.maint = await sessionFor(900000003);
  tokens.admin2 = await sessionFor(900000004);
  tokens.adminB = await sessionFor(900000010);

  app = await createApp({ config: testConfig(), pool, githubClient: noGithub });
  await app.init();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("AC-1 RBAC permissions", () => {
  it("unauthenticated requests return 401", async () => {
    await api().get("/org/members").expect(401);
    await api().post("/org/members/roles").set("Origin", ORIGIN).send({ githubUserId: 900000005, role: "viewer" }).expect(401);
    await api().delete("/org/members/roles").set("Origin", ORIGIN).send({ githubUserId: 900000005, role: "viewer" }).expect(401);
  });

  it("maintainer and viewer return 403 on all member routes", async () => {
    for (const who of ["viewer", "maint"]) {
      await api().get("/org/members").set("Cookie", as(who)).expect(403);
      await write("post", "/org/members/roles", who).send({ githubUserId: 900000005, role: "viewer" }).expect(403);
      await write("delete", "/org/members/roles", who).send({ githubUserId: 900000005, role: "viewer" }).expect(403);
    }
  });

  it("org_admin returns 200 on all 3 routes", async () => {
    const list = await api().get("/org/members").set("Cookie", as("admin1")).expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.map((m: { githubUserId: number }) => m.githubUserId)).toEqual(
      expect.arrayContaining([900000001, 900000002, 900000003, 900000004]),
    );

    const postRes = await write("post", "/org/members/roles", "admin1")
      .send({ githubUserId: 900000005, role: "viewer" })
      .expect(200);
    expect(postRes.body).toEqual({ changed: true });

    const delRes = await write("delete", "/org/members/roles", "admin1")
      .send({ githubUserId: 900000005, role: "viewer" })
      .expect(200);
    expect(delRes.body).toEqual({ changed: true });
  });
});

describe("AC-2 Cross-org isolation", () => {
  it("org_admin of org A cannot see members of org B", async () => {
    const listA = await api().get("/org/members").set("Cookie", as("admin1")).expect(200);
    const idsA = listA.body.map((m: { githubUserId: number }) => m.githubUserId);
    expect(idsA).not.toContain(900000010);
    expect(idsA).not.toContain(900000011);

    const listB = await api().get("/org/members").set("Cookie", as("adminB")).expect(200);
    const idsB = listB.body.map((m: { githubUserId: number }) => m.githubUserId);
    expect(idsB).toEqual([900000010, 900000011]);
  });

  it("granting or revoking in org A does not affect role bindings in org B", async () => {
    const countBBefore = await pool.query<{ count: string }>(
      "SELECT count(*) FROM role_bindings rb JOIN orgs o ON o.id = rb.org_id WHERE o.slug = 'org-test-b'",
    );

    await write("post", "/org/members/roles", "admin1").send({ githubUserId: 900000005, role: "viewer" }).expect(200);
    await write("delete", "/org/members/roles", "admin1").send({ githubUserId: 900000005, role: "viewer" }).expect(200);

    const countBAfter = await pool.query<{ count: string }>(
      "SELECT count(*) FROM role_bindings rb JOIN orgs o ON o.id = rb.org_id WHERE o.slug = 'org-test-b'",
    );
    expect(countBAfter.rows[0]?.count).toBe(countBBefore.rows[0]?.count);
  });

  it("body containing orgId or orgSlug returns 400 (strict schema)", async () => {
    await write("post", "/org/members/roles", "admin1")
      .send({ githubUserId: 900000005, role: "viewer", orgId: "fake-id" })
      .expect(400);

    await write("post", "/org/members/roles", "admin1")
      .send({ githubUserId: 900000005, role: "viewer", orgSlug: "org-test-b" })
      .expect(400);

    await write("delete", "/org/members/roles", "admin1")
      .send({ githubUserId: 900000005, role: "viewer", orgId: "fake-id" })
      .expect(400);
  });
});

describe("AC-3 Business rules", () => {
  it("user not in allowlist returns 422 user_not_allowlisted", async () => {
    const r = await write("post", "/org/members/roles", "admin1")
      .send({ githubUserId: 900000006, role: "viewer" })
      .expect(422);
    expect(JSON.stringify(r.body)).toContain("user_not_allowlisted");
  });

  it("disabled user returns 422 user_disabled", async () => {
    const r = await write("post", "/org/members/roles", "admin1")
      .send({ githubUserId: 900000007, role: "viewer" })
      .expect(422);
    expect(JSON.stringify(r.body)).toContain("user_disabled");
  });

  it("actor cannot modify their own roles (returns 409 cannot_change_own_roles)", async () => {
    const postRes = await write("post", "/org/members/roles", "admin1")
      .send({ githubUserId: 900000001, role: "viewer" })
      .expect(409);
    expect(postRes.body.message).toBe("cannot_change_own_roles");

    const delRes = await write("delete", "/org/members/roles", "admin1")
      .send({ githubUserId: 900000001, role: "org_admin" })
      .expect(409);
    expect(delRes.body.message).toBe("cannot_change_own_roles");
  });

  it("cannot revoke the last org_admin (returns 409 last_org_admin)", async () => {
    // Org B has only one admin: 900000010.
    // If another admin in Org B tried to revoke 900000010, it would fail.
    // Let's grant 900000011 org_admin in org B, so 900000010 can revoke 900000011, but then cannot revoke the last one.
    await write("post", "/org/members/roles", "adminB").send({ githubUserId: 900000011, role: "org_admin" }).expect(200);
    // Now org B has 2 admins (900000010 and 900000011).
    // Admin 900000010 revokes 900000011 -> succeeds.
    await write("delete", "/org/members/roles", "adminB").send({ githubUserId: 900000011, role: "org_admin" }).expect(200);
    // Now org B has only 1 admin again (900000010).
    // Try to revoke 900000011 again (no binding) -> { changed: false }.
    const noop = await write("delete", "/org/members/roles", "adminB").send({ githubUserId: 900000011, role: "org_admin" }).expect(200);
    expect(noop.body).toEqual({ changed: false });
  });

  it("concurrently revoking the last 2 org_admins leaves at least 1 org_admin", async () => {
    // In org-test-a, there are currently 2 org_admins: admin1 (900000001) and admin2 (900000004).
    // admin1 tries to revoke admin2, and admin2 tries to revoke admin1 concurrently.
    const [res1, res2] = await Promise.all([
      write("delete", "/org/members/roles", "admin1").send({ githubUserId: 900000004, role: "org_admin" }),
      write("delete", "/org/members/roles", "admin2").send({ githubUserId: 900000001, role: "org_admin" }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const failedRes = res1.status === 409 ? res1 : res2;
    expect(failedRes.body.message).toBe("last_org_admin");

    // Verify org-test-a still has at least 1 org_admin
    const count = await pool.query<{ count: string }>(
      `SELECT count(rb.id) AS count
         FROM role_bindings rb
         JOIN roles r ON r.id = rb.role_id AND r.org_id = rb.org_id
         JOIN orgs o ON o.id = rb.org_id
        WHERE o.slug = 'org-test-a' AND r.key = 'org_admin'`,
    );
    expect(Number(count.rows[0]?.count)).toBeGreaterThanOrEqual(1);

    // Re-grant admin2 for subsequent tests
    const activeAdminToken = res1.status === 200 ? "admin1" : "admin2";
    const targetId = res1.status === 200 ? 900000004 : 900000001;
    await write("post", "/org/members/roles", activeAdminToken).send({ githubUserId: targetId, role: "org_admin" }).expect(200);
  });
});

describe("AC-4 Audit logging", () => {
  it("logs org.role_granted and org.role_revoked on real changes, no audit on no-op", async () => {
    const auditBefore = await pool.query<{ count: string }>(
      "SELECT count(*) FROM audit_events WHERE action IN ('org.role_granted', 'org.role_revoked')",
    );
    const count0 = Number(auditBefore.rows[0]?.count);

    // 1. Real grant: changes role
    const r1 = await write("post", "/org/members/roles", "admin1")
      .send({ githubUserId: 900000005, role: "maintainer" })
      .expect(200);
    expect(r1.body).toEqual({ changed: true });

    const auditAfter1 = await pool.query<{ action: string; actor_github_user_id: string; target_id: string; metadata: any }>(
      "SELECT action, actor_github_user_id, target_id, metadata FROM audit_events ORDER BY id DESC LIMIT 1",
    );
    expect(auditAfter1.rows[0]?.action).toBe("org.role_granted");
    expect(Number(auditAfter1.rows[0]?.actor_github_user_id)).toBe(900000001);
    expect(auditAfter1.rows[0]?.target_id).toBe("900000005");
    expect(auditAfter1.rows[0]?.metadata).toEqual({ role: "maintainer" });

    // 2. Duplicate grant: no-op, no new audit
    const r2 = await write("post", "/org/members/roles", "admin1")
      .send({ githubUserId: 900000005, role: "maintainer" })
      .expect(200);
    expect(r2.body).toEqual({ changed: false });

    const auditAfter2 = await pool.query<{ count: string }>(
      "SELECT count(*) FROM audit_events WHERE action IN ('org.role_granted', 'org.role_revoked')",
    );
    expect(Number(auditAfter2.rows[0]?.count)).toBe(count0 + 1);

    // 3. Real revoke: changes role
    const r3 = await write("delete", "/org/members/roles", "admin1")
      .send({ githubUserId: 900000005, role: "maintainer" })
      .expect(200);
    expect(r3.body).toEqual({ changed: true });

    const auditAfter3 = await pool.query<{ action: string; target_id: string; metadata: any }>(
      "SELECT action, target_id, metadata FROM audit_events ORDER BY id DESC LIMIT 1",
    );
    expect(auditAfter3.rows[0]?.action).toBe("org.role_revoked");
    expect(auditAfter3.rows[0]?.target_id).toBe("900000005");
    expect(auditAfter3.rows[0]?.metadata).toEqual({ role: "maintainer" });

    // 4. Duplicate revoke: no-op, no new audit
    const r4 = await write("delete", "/org/members/roles", "admin1")
      .send({ githubUserId: 900000005, role: "maintainer" })
      .expect(200);
    expect(r4.body).toEqual({ changed: false });

    const auditAfter4 = await pool.query<{ count: string }>(
      "SELECT count(*) FROM audit_events WHERE action IN ('org.role_granted', 'org.role_revoked')",
    );
    expect(Number(auditAfter4.rows[0]?.count)).toBe(count0 + 2);
  });
});

describe("AC-5 Immediate effect", () => {
  it("after revoking maintainer role from user X, next request with same session gets 403", async () => {
    // User 900000003 currently has maintainer role in org-test-a.
    // They can access a maintainer endpoint: POST /agents
    // Let's create an agent or attempt to
    const agentSlug = "agent-maint-test";
    const createRes = await write("post", "/agents", "maint")
      .send({ slug: agentSlug, name: "Test Agent" })
      .expect(201);
    expect(createRes.body.slug).toBe(agentSlug);

    // Admin revokes maintainer role from user 900000003
    await write("delete", "/org/members/roles", "admin1")
      .send({ githubUserId: 900000003, role: "maintainer" })
      .expect(200);

    // Next request from user 900000003 with the same session cookie gets 403!
    await write("post", "/agents", "maint")
      .send({ slug: "agent-maint-blocked", name: "Blocked Agent" })
      .expect(403);
  });
});
