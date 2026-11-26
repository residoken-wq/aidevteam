import { redact } from "@aidevteam/contracts";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

/**
 * Create a pool from an explicit connection string. Callers read it from the environment
 * (DATABASE_URL); it must never be logged or hard-coded.
 */
export function createPool(
  connectionString: string,
  overrides: PoolConfig = {},
  onIdleClientError: (err: Error) => void = (err) => console.warn("postgres idle client error:", redact(err.message)),
): Pool {
  if (!connectionString) throw new Error("database connection string is required");
  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, ...overrides });
  // An idle pooled client can fail (e.g. the server restarts or terminates the backend). node-postgres then emits
  // 'error' on the Pool; with no listener Node treats it as fatal and the whole process crashes. The broken client is
  // already discarded by the pool, so log (redacted) and carry on — the next query opens a new connection.
  pool.on("error", onIdleClientError);
  return pool;
}

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}
