import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

/**
 * Create a pool from an explicit connection string. Callers read it from the environment
 * (DATABASE_URL); it must never be logged or hard-coded.
 */
export function createPool(connectionString: string, overrides: PoolConfig = {}): Pool {
  if (!connectionString) throw new Error("database connection string is required");
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, ...overrides });
}

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}
