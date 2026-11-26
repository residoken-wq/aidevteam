import { Controller, Get, type INestApplication } from "@nestjs/common";
import { createPool, migrateUp, type Pool } from "@aidevteam/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { writeAudit } from "../../src/audit";
import type { GithubOAuthClient } from "../../src/auth/github-client";
import { createApp } from "../../src/bootstrap";
import { Public } from "../../src/rbac/decorators";
import { testConfig } from "../helpers";

/** P1-07 AC-3/AC-4: secrets and personal data must not appear in API responses, logs or stored audit metadata. */
const FAKE_DB_PASSWORD = "Sup3rS3cretFakePw";
const FAKE_TOKEN = "ghp_" + "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2";

@Public()
@Controller("__probe")
class FailingController {
  @Get("boom")
  boom(): never {
    throw new Error(`connect failed postgres://app:${FAKE_DB_PASSWORD}@db.internal:5432/x token ${FAKE_TOKEN} owner test09@example.com`);
  }
}

const noGithub: GithubOAuthClient = {
  exchangeCodeForIdentity: async () => {
    throw new Error("not used");
  },
};

let pool: Pool;
let app: INestApplication;

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test$/.test(new URL(url).pathname.slice(1))) throw new Error("TEST_DATABASE_URL with a *_test database is required");
  pool = createPool(url, { max: 3 });
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrateUp(pool);
  app = await createApp({ config: testConfig(), pool, githubClient: noGithub, extraControllers: [FailingController] });
  await app.init();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("unhandled errors", () => {
  it("return a generic 500 and log only redacted text", async () => {
    let logged = "";
    const capture = (chunk: unknown) => {
      logged += String(chunk);
      return true;
    };
    const a = vi.spyOn(process.stdout, "write").mockImplementation(capture as never);
    const b = vi.spyOn(process.stderr, "write").mockImplementation(capture as never);
    try {
      const res = await request(app.getHttpServer()).get("/__probe/boom").expect(500);
      const body = JSON.stringify(res.body);
      for (const leaked of [FAKE_DB_PASSWORD, FAKE_TOKEN, "test09@example.com", "db.internal"]) expect(body).not.toContain(leaked);
    } finally {
      a.mockRestore();
      b.mockRestore();
    }
    expect(logged).toContain("connect failed"); // the error was logged…
    for (const leaked of [FAKE_DB_PASSWORD, FAKE_TOKEN, "test09@example.com"]) expect(logged).not.toContain(leaked); // …redacted
  });
});

describe("audit metadata", () => {
  it("is redacted before it is stored", async () => {
    await writeAudit(pool, {
      action: "test.redaction",
      metadata: { note: `user test10@example.com phone +84912345678 key ${FAKE_TOKEN}`, client_secret: "should-not-store" },
    });
    const r = await pool.query("SELECT metadata::text AS m FROM audit_events WHERE action = 'test.redaction'");
    const stored = String(r.rows[0].m);
    for (const leaked of ["test10@example.com", "+84912345678", FAKE_TOKEN, "should-not-store"]) expect(stored).not.toContain(leaked);
  });
});
