import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrateDown, migrateUp } from "../../src/migrate";
import { resetSchema, testPool } from "./helpers";

describe("AC-6 Migration 0013 & tasks.contract CHECK constraint", () => {
  const pool: Pool = testPool();
  beforeEach(() => resetSchema(pool));
  afterAll(() => pool.end());

  it("applies migrations up → down → up cleanly", async () => {
    const all = loadMigrations().map((m) => m.version);
    expect(await migrateUp(pool)).toEqual(all);

    // Verify contract column exists
    const colCheck = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'contract'",
    );
    expect(colCheck.rows.length).toBe(1);

    // Roll back migration 0013
    const rolledBack = await migrateDown(pool, 1);
    expect(rolledBack).toEqual(["0013"]);

    // Verify contract column is gone
    const colCheckAfter = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'contract'",
    );
    expect(colCheckAfter.rows.length).toBe(0);

    // Re-apply migration 0013
    const reApplied = await migrateUp(pool);
    expect(reApplied).toEqual(["0013"]);
  }, 30000);

  it("DB CHECK blocks contract that is not an object (array, number, string, boolean)", async () => {
    await migrateUp(pool);

    // Setup org and project
    const orgRes = await pool.query<{ id: string }>(
      "INSERT INTO orgs (slug, name) VALUES ('org-chk-test', 'Org Check Test') RETURNING id",
    );
    const orgId = orgRes.rows[0]!.id;

    const projRes = await pool.query<{ id: string }>(
      "INSERT INTO projects (org_id, slug, name) VALUES ($1, 'proj-chk', 'Proj Check') RETURNING id",
      [orgId],
    );
    const projectId = projRes.rows[0]!.id;

    // NULL contract is allowed
    await pool.query(
      "INSERT INTO tasks (org_id, project_id, number, title, contract) VALUES ($1, $2, 1, 'Task Null', NULL)",
      [orgId, projectId],
    );

    // Valid JSON object contract is allowed
    const validContract = JSON.stringify({ version: 1, objective: "Test objective" });
    await pool.query(
      "INSERT INTO tasks (org_id, project_id, number, title, contract) VALUES ($1, $2, 2, 'Task Valid', $3)",
      [orgId, projectId, validContract],
    );

    // JSON array is rejected
    await expect(
      pool.query(
        "INSERT INTO tasks (org_id, project_id, number, title, contract) VALUES ($1, $2, 3, 'Task Array', '[1, 2, 3]')",
        [orgId, projectId],
      ),
    ).rejects.toThrow();

    // JSON number is rejected
    await expect(
      pool.query(
        "INSERT INTO tasks (org_id, project_id, number, title, contract) VALUES ($1, $2, 4, 'Task Number', '12345')",
        [orgId, projectId],
      ),
    ).rejects.toThrow();

    // JSON string is rejected
    await expect(
      pool.query(
        "INSERT INTO tasks (org_id, project_id, number, title, contract) VALUES ($1, $2, 5, 'Task String', '\"not-an-object\"')",
        [orgId, projectId],
      ),
    ).rejects.toThrow();

    // JSON boolean is rejected
    await expect(
      pool.query(
        "INSERT INTO tasks (org_id, project_id, number, title, contract) VALUES ($1, $2, 6, 'Task Bool', 'true')",
        [orgId, projectId],
      ),
    ).rejects.toThrow();
  });

  it("DB CHECK blocks contract larger than 64 KB (65536 bytes)", async () => {
    await migrateUp(pool);

    const orgRes = await pool.query<{ id: string }>(
      "INSERT INTO orgs (slug, name) VALUES ('org-chk-size', 'Org Check Size') RETURNING id",
    );
    const orgId = orgRes.rows[0]!.id;

    const projRes = await pool.query<{ id: string }>(
      "INSERT INTO projects (org_id, slug, name) VALUES ($1, 'proj-size', 'Proj Size') RETURNING id",
      [orgId],
    );
    const projectId = projRes.rows[0]!.id;

    // Contract > 64 KB
    const oversized = JSON.stringify({
      version: 1,
      objective: "Oversized",
      notes: "x".repeat(70000),
    });

    await expect(
      pool.query(
        "INSERT INTO tasks (org_id, project_id, number, title, contract) VALUES ($1, $2, 1, 'Task Oversized', $3)",
        [orgId, projectId, oversized],
      ),
    ).rejects.toThrow();
  });
});
