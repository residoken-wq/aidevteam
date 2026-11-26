import type { Pool } from "@aidevteam/db";
import { loadMigrations } from "@aidevteam/db";
import { describe, expect, it } from "vitest";
import { HealthService } from "../../src/health/health.service";

const LATEST = loadMigrations().at(-1)!.version;

function fakePool(behaviour: (sql: string) => Promise<unknown>): Pool {
  return { query: (sql: string) => behaviour(sql) } as unknown as Pool;
}

describe("HealthService.readiness", () => {
  it("ok when the database answers and is at the latest migration", async () => {
    const svc = new HealthService(fakePool(async (sql) => (sql.includes("schema_migrations") ? { rows: [{ version: LATEST }] } : { rows: [] })));
    expect(await svc.readiness()).toEqual({ status: "ok", checks: { database: "ok", migrations: "ok" } });
  });

  it("ok when the DB is ahead of this build (image rollback after a migration)", async () => {
    const svc = new HealthService(fakePool(async (sql) => (sql.includes("schema_migrations") ? { rows: [{ version: "9999" }] } : { rows: [] })));
    expect((await svc.readiness()).status).toBe("ok");
  });

  it("unavailable when migrations are pending or none are applied", async () => {
    for (const version of ["0001", null]) {
      const svc = new HealthService(fakePool(async (sql) => (sql.includes("schema_migrations") ? { rows: [{ version }] } : { rows: [] })));
      expect(await svc.readiness()).toEqual({ status: "unavailable", checks: { database: "ok", migrations: "unavailable" } });
    }
  });

  it("unavailable (not hanging) when the database does not answer in time", async () => {
    const svc = new HealthService(fakePool(() => new Promise(() => undefined)));
    const started = Date.now();
    expect(await svc.readiness(50)).toEqual({ status: "unavailable", checks: { database: "unavailable", migrations: "unavailable" } });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("unavailable when the migrations table is missing", async () => {
    const svc = new HealthService(
      fakePool(async (sql) => {
        if (sql.includes("schema_migrations")) throw new Error('relation "schema_migrations" does not exist');
        return { rows: [] };
      }),
    );
    expect((await svc.readiness()).checks).toEqual({ database: "ok", migrations: "unavailable" });
  });
});
