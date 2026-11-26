import { getTableConfig } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateUp } from "../../src/migrate";
import { allTables } from "../../src/schema";
import { resetSchema, tableNames, testPool } from "./helpers";

let pool: Pool;
beforeAll(async () => {
  pool = testPool();
  await resetSchema(pool);
  await migrateUp(pool);
});
afterAll(() => pool.end());

describe("Drizzle schema matches the migrated database", () => {
  it("covers exactly the migrated tables", async () => {
    const db = (await tableNames(pool)).filter((t) => t !== "schema_migrations");
    expect(Object.keys(allTables).sort()).toEqual(db);
  });

  it.each(Object.entries(allTables))("%s: same columns and nullability", async (name, table) => {
    const cfg = getTableConfig(table);
    expect(cfg.name).toBe(name);
    const fromDrizzle = cfg.columns.map((c) => `${c.name}:${c.notNull ? "NOT NULL" : "NULL"}`).sort();
    const r = await pool.query<{ column_name: string; is_nullable: string }>(
      "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
      [name],
    );
    const fromDb = r.rows.map((c) => `${c.column_name}:${c.is_nullable === "YES" ? "NULL" : "NOT NULL"}`).sort();
    expect(fromDrizzle).toEqual(fromDb);
  });
});
