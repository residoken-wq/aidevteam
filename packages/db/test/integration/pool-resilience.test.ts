import { afterAll, describe, expect, it } from "vitest";
import { createPool } from "../../src/client";
import { testPool } from "./helpers";

/**
 * Bug found in P1-10 E2E (26/11/2026): when PostgreSQL terminates an idle pooled connection, node-postgres emits
 * 'error' on the Pool. Without a listener that is an unhandled 'error' event and the whole api process crashes
 * (taking /health/live down with it). The pool must survive and recover on the next query.
 */
const admin = testPool();
afterAll(() => admin.end());

describe("createPool resilience", () => {
  it("survives the server terminating an idle connection and recovers", async () => {
    const pool = createPool(process.env.TEST_DATABASE_URL!, { max: 1 });
    try {
      const pid = (await pool.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid; // client now idle in pool
      await admin.query("SELECT pg_terminate_backend($1)", [pid]);
      await new Promise((r) => setTimeout(r, 300)); // let the 'error' event fire
      const again = await pool.query<{ ok: number }>("SELECT 1 AS ok");
      expect(again.rows[0]!.ok).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
