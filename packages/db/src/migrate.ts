import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";

/**
 * Minimal, explicit migration runner with paired up/down SQL files.
 *
 * Why not drizzle-kit migrate: it has no down migrations, and CLAUDE.md §8 requires every
 * migration to have a rollback that is tested in both directions. Drizzle ORM is still used
 * for the typed schema and queries (see schema.ts); a drift test keeps both in sync.
 *
 * Guarantees:
 *  - each migration runs in its own transaction together with its bookkeeping row;
 *  - a session-level advisory lock serialises concurrent runners;
 *  - an applied migration whose up.sql changed afterwards is detected (checksum) and blocks further work.
 */

export const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.(up|down)\.sql$/;
// Arbitrary constant key for pg_advisory_lock, unique to this application.
const LOCK_KEY = 7_340_120_251;

export interface Migration {
  version: string;
  name: string;
  upSql: string;
  downSql: string;
  checksum: string;
}

export interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
}

export class MigrationError extends Error {}

export function loadMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const byVersion = new Map<string, { name: string; up?: string; down?: string }>();

  for (const file of files) {
    const m = FILE_RE.exec(file);
    if (!m) throw new MigrationError(`invalid migration file name: ${file}`);
    const [, version, name, direction] = m as unknown as [string, string, string, "up" | "down"];
    const entry = byVersion.get(version) ?? { name };
    if (entry.name !== name) throw new MigrationError(`version ${version} has two different names`);
    entry[direction] = readFileSync(path.join(dir, file), "utf8");
    byVersion.set(version, entry);
  }

  const versions = [...byVersion.keys()].sort();
  return versions.map((version, i) => {
    const expected = String(i + 1).padStart(4, "0");
    if (version !== expected) throw new MigrationError(`migration versions must be contiguous: expected ${expected}, got ${version}`);
    const e = byVersion.get(version)!;
    if (e.up === undefined || e.down === undefined) {
      throw new MigrationError(`migration ${version}_${e.name} must have both .up.sql and .down.sql`);
    }
    return { version, name: e.name, upSql: e.up, downSql: e.down, checksum: sha256(e.up) };
  });
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function withLock<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        name       text NOT NULL,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      return await fn(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

async function applied(client: PoolClient): Promise<AppliedMigration[]> {
  const res = await client.query<AppliedMigration>("SELECT version, name, checksum FROM schema_migrations ORDER BY version");
  return res.rows;
}

function verifyHistory(done: AppliedMigration[], all: Migration[]): void {
  for (const row of done) {
    const m = all.find((x) => x.version === row.version);
    if (!m) throw new MigrationError(`applied migration ${row.version}_${row.name} is missing from the migrations directory`);
    if (m.checksum !== row.checksum) {
      throw new MigrationError(`checksum mismatch for applied migration ${row.version}_${row.name}: up.sql was modified after it was applied`);
    }
  }
}

async function inTransaction(client: PoolClient, fn: () => Promise<void>): Promise<void> {
  await client.query("BEGIN");
  try {
    await fn();
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/** Apply all pending migrations. Returns the versions applied. */
export async function migrateUp(pool: Pool, dir?: string): Promise<string[]> {
  const all = loadMigrations(dir);
  return withLock(pool, async (client) => {
    const done = await applied(client);
    verifyHistory(done, all);
    const doneSet = new Set(done.map((d) => d.version));
    const ran: string[] = [];
    for (const m of all) {
      if (doneSet.has(m.version)) continue;
      await inTransaction(client, async () => {
        await client.query(m.upSql);
        await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [m.version, m.name, m.checksum]);
      });
      ran.push(m.version);
    }
    return ran;
  });
}

/** Roll back the latest `steps` applied migrations. Destroys data — callers must guard. */
export async function migrateDown(pool: Pool, steps: number, dir?: string): Promise<string[]> {
  if (!Number.isInteger(steps) || steps < 1) throw new MigrationError("steps must be a positive integer");
  const all = loadMigrations(dir);
  return withLock(pool, async (client) => {
    const done = await applied(client);
    verifyHistory(done, all);
    const toRevert = done.slice(-steps).reverse();
    const ran: string[] = [];
    for (const row of toRevert) {
      const m = all.find((x) => x.version === row.version)!;
      await inTransaction(client, async () => {
        await client.query(m.downSql);
        await client.query("DELETE FROM schema_migrations WHERE version = $1", [m.version]);
      });
      ran.push(m.version);
    }
    return ran;
  });
}

export async function migrationStatus(pool: Pool, dir?: string): Promise<{ applied: string[]; pending: string[] }> {
  const all = loadMigrations(dir);
  return withLock(pool, async (client) => {
    const done = await applied(client);
    verifyHistory(done, all);
    const doneSet = new Set(done.map((d) => d.version));
    return {
      applied: done.map((d) => `${d.version}_${d.name}`),
      pending: all.filter((m) => !doneSet.has(m.version)).map((m) => `${m.version}_${m.name}`),
    };
  });
}
