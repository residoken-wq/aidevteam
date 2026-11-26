import type { INestApplication } from "@nestjs/common";
import { createPool, grantRole, migrateUp, seed, type Pool } from "@aidevteam/db";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { GithubOAuthClient } from "../../src/auth/github-client";
import { createApp } from "../../src/bootstrap";
import { SESSION_COOKIE } from "../../src/cookies";
import { testConfig } from "../helpers";

/**
 * P2-07 provider accounts. Fake data only:
 *   900000002 viewer     org-test-a
 *   900000003 maintainer org-test-a
 *   900000004 maintainer org-test-b
 */
const ORIGIN = "https://cc.example.com";
const FAKE_KEY = "sk-ant-" + "api03-P207FakeFakeFakeFakeFakeFake";
const noGithub: GithubOAuthClient = {
  exchangeCodeForIdentity: async () => {
    throw new Error("not used");
  },
};

let pool: Pool;
let app: INestApplication;
const tokens: Record<string, string> = {};

async function sessionFor(githubUserId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     SELECT id, $2, now() + interval '1 hour' FROM users WHERE github_user_id = $1`,
    [githubUserId, createHash("sha256").update(token).digest()],
  );
  return token;
}
const as = (who: string) => `${SESSION_COOKIE}=${tokens[who]}`;
const api = () => request(app.getHttpServer());
const write = (method: "post" | "patch", path: string, who: string) => api()[method](path).set("Origin", ORIGIN).set("Cookie", as(who));
const valid = (slug: string) => ({ slug, name: `Account ${slug}`, provider: "anthropic", secretRef: `env:AIDEV_SECRET_${slug.toUpperCase().replace(/-/g, "_")}` });

async function dbDump(): Promise<string> {
  const r = await pool.query(
    `SELECT string_agg(t, '|') AS all_rows FROM (
       SELECT row_to_json(p)::text AS t FROM provider_accounts p
       UNION ALL SELECT row_to_json(a)::text FROM audit_events a) x`,
  );
  return String(r.rows[0].all_rows);
}

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test$/.test(new URL(url).pathname.slice(1))) throw new Error("TEST_DATABASE_URL with a *_test database is required");
  pool = createPool(url, { max: 5 });
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrateUp(pool);
  await seed(pool, { NODE_ENV: "test" });
  for (const id of [900000003, 900000004]) await pool.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, 'fake')", [id]);
  await grantRole(pool, 900000002, "org-test-a", "viewer");
  await grantRole(pool, 900000003, "org-test-a", "maintainer");
  await grantRole(pool, 900000004, "org-test-b", "maintainer");
  tokens.viewer = await sessionFor(900000002);
  tokens.maintA = await sessionFor(900000003);
  tokens.maintB = await sessionFor(900000004);
  app = await createApp({ config: testConfig(), pool, githubClient: noGithub });
  await app.init();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("AC-1 CRUD with the right role", () => {
  it("maintainer creates, lists, rotates the reference and archives", async () => {
    const created = await write("post", "/provider-accounts", "maintA").send(valid("claude-main")).expect(201);
    expect(created.body).toMatchObject({ slug: "claude-main", provider: "anthropic", secretRef: "env:AIDEV_SECRET_CLAUDE_MAIN", archivedAt: null });
    expect(created.body).not.toHaveProperty("id");
    const rotated = await write("patch", "/provider-accounts/claude-main", "maintA").send({ secretRef: "file:/run/secrets/claude-main-v2" }).expect(200);
    expect(rotated.body.secretRef).toBe("file:/run/secrets/claude-main-v2");
    await write("post", "/provider-accounts/claude-main/archive", "maintA").expect(200);
    const list = await api().get("/provider-accounts").set("Cookie", as("maintA")).expect(200);
    expect(list.body.items.map((p: { slug: string }) => p.slug)).not.toContain("claude-main");
  });
});

describe("AC-2 missing permission", () => {
  it("viewer reads (incl. the reference, per RBAC_MATRIX) but cannot write", async () => {
    await write("post", "/provider-accounts", "maintA").send(valid("viewer-target")).expect(201);
    const got = await api().get("/provider-accounts/viewer-target").set("Cookie", as("viewer")).expect(200);
    expect(got.body.secretRef).toBe("env:AIDEV_SECRET_VIEWER_TARGET");
    await write("post", "/provider-accounts", "viewer").send(valid("by-viewer")).expect(403);
    await write("patch", "/provider-accounts/viewer-target", "viewer").send({ secretRef: "env:AIDEV_SECRET_HIJACK" }).expect(403);
    await write("post", "/provider-accounts/viewer-target/archive", "viewer").expect(403);
  });

  it("401 without session, 403 without matching Origin", async () => {
    await api().get("/provider-accounts").expect(401);
    await api().post("/provider-accounts").set("Cookie", as("maintA")).send(valid("no-origin")).expect(403);
  });
});

describe("AC-3 cross-org isolation", () => {
  it("org B cannot see or touch org A's account", async () => {
    await write("post", "/provider-accounts", "maintA").send(valid("org-a-only")).expect(201);
    const list = await api().get("/provider-accounts?archived=true").set("Cookie", as("maintB")).expect(200);
    expect(JSON.stringify(list.body)).not.toContain("ORG_A_ONLY");
    await api().get("/provider-accounts/org-a-only").set("Cookie", as("maintB")).expect(404);
    await write("patch", "/provider-accounts/org-a-only", "maintB").send({ secretRef: "env:AIDEV_SECRET_STOLEN" }).expect(404);
    await write("post", "/provider-accounts/org-a-only/archive", "maintB").expect(404);
    const a = await api().get("/provider-accounts/org-a-only").set("Cookie", as("maintA")).expect(200);
    expect(a.body.secretRef).toBe("env:AIDEV_SECRET_ORG_A_ONLY");
  });

  it("org id in the body is rejected", async () => {
    await write("post", "/provider-accounts", "maintA").send({ ...valid("smuggle"), orgId: "x" }).expect(422);
  });
});

describe("AC-4 / AC-7 secrets never stored, returned or logged", () => {
  it("a pasted credential is refused with secret_like; value absent from response, DB and logs; event audited", async () => {
    let logged = "";
    const capture = (chunk: unknown) => {
      logged += String(chunk);
      return true;
    };
    const a = vi.spyOn(process.stdout, "write").mockImplementation(capture as never);
    const b = vi.spyOn(process.stderr, "write").mockImplementation(capture as never);
    let res: request.Response;
    try {
      res = await write("post", "/provider-accounts", "maintA").send({ ...valid("pasted"), secretRef: FAKE_KEY }).expect(422);
      await write("post", "/provider-accounts", "maintA").send(valid("rotate-me")).expect(201);
      await write("patch", "/provider-accounts/rotate-me", "maintA").send({ secretRef: FAKE_KEY }).expect(422);
    } finally {
      a.mockRestore();
      b.mockRestore();
    }
    expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY);
    expect(res.body.issues[0]).toMatchObject({ path: "secretRef", problem: "secret_like" });
    expect(logged).not.toContain(FAKE_KEY);
    expect(await dbDump()).not.toContain(FAKE_KEY);
    const events = await pool.query("SELECT metadata FROM audit_events WHERE action = 'security.secret_like_rejected'");
    expect(events.rowCount).toBe(2);
    expect(events.rows[0].metadata).toEqual({ field: "secretRef" });
    expect((await api().get("/provider-accounts/rotate-me").set("Cookie", as("maintA")).expect(200)).body.secretRef).toBe("env:AIDEV_SECRET_ROTATE_ME");
  });

  it("references to Control Center's own variables or paths are refused", async () => {
    for (const ref of ["env:DATABASE_URL", "env:GITHUB_OAUTH_CLIENT_SECRET", "file:/etc/aidevteam/app.env", "file:/run/secrets/../../etc/passwd"]) {
      await write("post", "/provider-accounts", "maintA").send({ ...valid("bad-ref"), secretRef: ref }).expect(422);
    }
  });

  it("unknown providers and extra fields such as apiKey are refused", async () => {
    await write("post", "/provider-accounts", "maintA").send({ ...valid("aws"), provider: "aws" }).expect(422);
    const res = await write("post", "/provider-accounts", "maintA").send({ ...valid("extra"), apiKey: FAKE_KEY }).expect(422);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY);
  });
});

describe("AC-5 audit and conflicts", () => {
  it("one event per change; rotation recorded as a field name, not a value", async () => {
    await write("post", "/provider-accounts", "maintA").send(valid("audited")).expect(201);
    await write("patch", "/provider-accounts/audited", "maintA").send({ secretRef: "env:AIDEV_SECRET_AUDITED_V2" }).expect(200);
    await write("post", "/provider-accounts/audited/archive", "maintA").expect(200);
    const r = await pool.query(
      "SELECT action, metadata FROM audit_events WHERE metadata->>'slug' = 'audited' AND action LIKE 'provider_account.%' ORDER BY id",
    );
    expect(r.rows.map((x) => x.action)).toEqual(["provider_account.created", "provider_account.updated", "provider_account.archived"]);
    expect(r.rows[1].metadata).toEqual({ slug: "audited", fields: "secretRef" });
    expect(JSON.stringify(r.rows)).not.toContain("AIDEV_SECRET_AUDITED_V2");
  });

  it("duplicate slug → 409; archived account cannot be edited or archived again", async () => {
    await write("post", "/provider-accounts", "maintA").send(valid("dup-pa")).expect(201);
    await write("post", "/provider-accounts", "maintA").send(valid("dup-pa")).expect(409);
    await write("post", "/provider-accounts/dup-pa/archive", "maintA").expect(200);
    await write("post", "/provider-accounts/dup-pa/archive", "maintA").expect(409);
    await write("patch", "/provider-accounts/dup-pa", "maintA").send({ name: "Revived" }).expect(409);
  });
});
