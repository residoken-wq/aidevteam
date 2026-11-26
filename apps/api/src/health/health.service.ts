import { Inject, Injectable } from "@nestjs/common";
import type { HealthResponse, HealthStatus } from "@aidevteam/contracts";
import { loadMigrations, type Pool } from "@aidevteam/db";
import { DB_POOL } from "../tokens";

export const READINESS_TIMEOUT_MS = 2000;

/** Latest migration version shipped with this build — the database must be at least at this version. */
const EXPECTED_MIGRATION = (() => {
  const all = loadMigrations();
  return all.length ? all[all.length - 1]!.version : null;
})();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e: unknown) => (clearTimeout(t), reject(e)),
    );
  });
}

/**
 * Readiness: the database answers within the timeout AND its schema is at least at the version this build expects.
 * - DB behind the build (migrations not run yet) → unavailable: the image must not serve an older schema.
 * - DB ahead of the build → ok: this is an image rollback after a migration; migrations must stay
 *   backward compatible for one version (docs/operations/CICD.md §6), so the older image can run.
 * Details never leave the process: callers only see ok/unavailable per check.
 */
@Injectable()
export class HealthService {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async readiness(timeoutMs = READINESS_TIMEOUT_MS): Promise<HealthResponse> {
    let database: HealthStatus = "unavailable";
    let migrations: HealthStatus = "unavailable";
    try {
      await withTimeout(this.pool.query("SELECT 1"), timeoutMs);
      database = "ok";
      const r = await withTimeout(
        // A missing schema_migrations table raises an error → caught below → "unavailable".
        this.pool.query<{ version: string | null }>("SELECT max(version) AS version FROM schema_migrations"),
        timeoutMs,
      );
      const current = r.rows[0]?.version ?? null;
      // Versions are zero-padded 4-digit strings, so string comparison orders them correctly.
      migrations = EXPECTED_MIGRATION !== null && current !== null && current >= EXPECTED_MIGRATION ? "ok" : "unavailable";
    } catch {
      // Intentionally swallowed: the reason is not exposed on an unauthenticated endpoint.
    }
    const ok = database === "ok" && migrations === "ok";
    return { status: ok ? "ok" : "unavailable", checks: { database, migrations } };
  }
}
