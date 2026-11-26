import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addToAllowlist, removeFromAllowlist } from "../../src/allowlist";
import { migrateUp } from "../../src/migrate";
import { resetSchema, testPool } from "./helpers";

let pool: Pool;
beforeAll(async () => {
  pool = testPool();
  await resetSchema(pool);
  await migrateUp(pool);
});
afterAll(() => pool.end());

describe("allowlist management", () => {
  it("adds once, audits once", async () => {
    expect(await addToAllowlist(pool, 900000010, "fake operator test")).toBe(true);
    expect(await addToAllowlist(pool, 900000010, "again")).toBe(false);
    const a = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'admin.allowlist_added' AND target_id = '900000010'");
    expect(a.rows[0].n).toBe(1);
  });

  it("removal revokes that user's active sessions and is audited", async () => {
    const u = await pool.query<{ id: string }>("INSERT INTO users (github_user_id, github_login) VALUES (900000010, 'test-user-10') RETURNING id");
    await pool.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [u.rows[0]!.id, Buffer.alloc(32, 9)]);
    expect(await removeFromAllowlist(pool, 900000010)).toBe(true);
    const s = await pool.query("SELECT count(*)::int AS n FROM sessions WHERE revoked_at IS NULL");
    expect(s.rows[0].n).toBe(0);
    const a = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'admin.allowlist_removed'");
    expect(a.rows[0].n).toBe(1);
    expect(await removeFromAllowlist(pool, 900000010)).toBe(false);
  });
});
