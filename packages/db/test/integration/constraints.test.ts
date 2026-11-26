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
