import { Pool } from "pg";

/**
 * Integration tests DESTROY the target database schema. To make pointing them at a real
 * database impossible by accident, the database name must end with "_test".
 */
export function testPool(): Pool {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required for integration tests (database name must end with _test)");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!/_test$/.test(dbName)) throw new Error("refusing to run: TEST_DATABASE_URL database name must end with _test");
  return new Pool({ connectionString: url, max: 5 });
}

export async function resetSchema(pool: Pool): Promise<void> {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
}

export async function tableNames(pool: Pool): Promise<string[]> {
  const r = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  return r.rows.map((x) => x.table_name);
}

export const SHA40 = "a".repeat(40);
export const DIGEST = `sha256:${"b".repeat(64)}`;
export const COMMENT_URL = "https://github.com/example-org/example-repo/pull/12#issuecomment-1001";
