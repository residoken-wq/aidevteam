import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrateDown, migrateUp, migrationStatus } from "../../src/migrate";
import { resetSchema, tableNames, testPool } from "./helpers";

const EXPECTED_TABLES = [
  "agent_runs",
  "agents",
  "audit_events",
  "oauth_login_states",
  "orgs",
  "platform_admins",
  "project_assignments",
  "projects",
  "provider_accounts",
  "rate_limit_hits",
  "release_approvals",
  "role_bindings",
  "roles",
  "schema_migrations",
  "sessions",
  "task_dependencies",
  "tasks",
  "user_allowlist",
  "users",
  "workers",
];

describe("migrations up/down (AC-1)", () => {
  const pool: Pool = testPool();
  beforeEach(() => resetSchema(pool));
  afterAll(() => pool.end());

  it("up → down → up on an empty database", async () => {
    const all = loadMigrations().map((m) => m.version);
    expect(await migrateUp(pool)).toEqual(all);
    expect(await tableNames(pool)).toEqual(EXPECTED_TABLES);

    expect(await migrateDown(pool, all.length)).toEqual([...all].reverse());
    expect(await tableNames(pool)).toEqual(["schema_migrations"]);
    const fn = await pool.query("SELECT 1 FROM pg_proc WHERE proname = 'forbid_mutation'");
    expect(fn.rowCount).toBe(0);

    expect(await migrateUp(pool)).toEqual(all);
    expect(await tableNames(pool)).toEqual(EXPECTED_TABLES);
  }, 30_000);

  it("is idempotent: a second up applies nothing", async () => {
    await migrateUp(pool);
    expect(await migrateUp(pool)).toEqual([]);
    expect((await migrationStatus(pool)).pending).toEqual([]);
  }, 15_000);

  it("serialises concurrent runners (advisory lock): each migration applied once", async () => {
    const results = await Promise.all([migrateUp(pool), migrateUp(pool), migrateUp(pool)]);
    const total = results.flat();
    expect(total.sort()).toEqual(loadMigrations().map((m) => m.version));
  }, 30_000);

  it("fails closed when an applied migration was modified afterwards", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mig-"));
    try {
      writeFileSync(path.join(dir, "0001_t.up.sql"), "CREATE TABLE t_probe (id int);");
      writeFileSync(path.join(dir, "0001_t.down.sql"), "DROP TABLE t_probe;");
      await migrateUp(pool, dir);
      writeFileSync(path.join(dir, "0001_t.up.sql"), "CREATE TABLE t_probe (id int, extra int);");
      await expect(migrateUp(pool, dir)).rejects.toThrow(/checksum mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rolls back a failing migration completely (no partial schema, no bookkeeping row)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mig-"));
    try {
      writeFileSync(path.join(dir, "0001_bad.up.sql"), "CREATE TABLE half_done (id int); SELECT * FROM no_such_table;");
      writeFileSync(path.join(dir, "0001_bad.down.sql"), "DROP TABLE half_done;");
      await expect(migrateUp(pool, dir)).rejects.toThrow();
      expect(await tableNames(pool)).toEqual(["schema_migrations"]);
      expect((await pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
