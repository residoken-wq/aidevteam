import type { INestApplication } from "@nestjs/common";
import { createPool, migrateDown, migrateUp, type Pool } from "@aidevteam/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/bootstrap";
import { testConfig } from "../helpers";

let pool: Pool;
let app: INestApplication;

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test$/.test(new URL(url).pathname.slice(1))) throw new Error("TEST_DATABASE_URL with a *_test database is required");
  pool = createPool(url, { max: 3 });
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  app = await createApp({ config: testConfig(), pool });
  await app.init();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("/health/ready against a real PostgreSQL (P1-10)", () => {
  it("503 before migrations are applied", async () => {
    const res = await request(app.getHttpServer()).get("/health/ready").expect(503);
    expect(res.body.checks).toEqual({ database: "ok", migrations: "unavailable" });
  });

  it("200 once the schema is at the latest migration", async () => {
    await migrateUp(pool);
    const res = await request(app.getHttpServer()).get("/health/ready").expect(200);
    expect(res.body).toEqual({ status: "ok", checks: { database: "ok", migrations: "ok" } });
  });

  it("503 again after a rollback (schema behind this build)", async () => {
    await migrateDown(pool, 1);
    await request(app.getHttpServer()).get("/health/ready").expect(503);
    await migrateUp(pool);
    await request(app.getHttpServer()).get("/health/ready").expect(200);
  });
});
