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
    // Pool is lazy and never queried by health endpoints in P1-05G (DB readiness check comes with P1-10).
    app = await createApp({ config: testConfig(), pool: createPool("postgres://unused@127.0.0.1:1/unused_test") });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(["/health/live", "/health/ready"])("GET %s returns a contract-valid ok response", async (path) => {
    const res = await request(app.getHttpServer()).get(path).expect(200);
    expect(HealthResponseSchema.parse(res.body)).toEqual({ status: "ok", checks: {} });
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
