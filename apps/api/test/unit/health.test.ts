import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HealthResponseSchema } from "@aidevteam/contracts";
import { createPool } from "@aidevteam/db";
import { createApp } from "../../src/bootstrap";
import { testConfig } from "../helpers";

describe("health endpoints", () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Points at a port where nothing listens: the database is "down" for these tests.
    app = await createApp({ config: testConfig(), pool: createPool("postgres://unused@127.0.0.1:1/unused_test") });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("live stays 200 when the database is down (no needless container restarts)", async () => {
    const res = await request(app.getHttpServer()).get("/health/live").expect(200);
    expect(HealthResponseSchema.parse(res.body)).toEqual({ status: "ok", checks: {} });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("ready is 503 with only ok/unavailable flags when the database is down", async () => {
    const res = await request(app.getHttpServer()).get("/health/ready").expect(503);
    expect(HealthResponseSchema.parse(res.body)).toEqual({ status: "unavailable", checks: { database: "unavailable", migrations: "unavailable" } });
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|postgres|unused/);
  });

  it("does not send the x-powered-by header", async () => {
    const res = await request(app.getHttpServer()).get("/health/live");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("returns 404 without stack traces for unknown routes", async () => {
    const res = await request(app.getHttpServer()).get("/does-not-exist").expect(404);
    expect(JSON.stringify(res.body)).not.toMatch(/at\s+\S+\s+\(|node_modules|\/src\//);
  });
});
