import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrg, grantRole, listBindings, revokeRole } from "../../src/admin";
import { addToAllowlist } from "../../src/allowlist";
import { migrateUp } from "../../src/migrate";
import { resetSchema, testPool } from "./helpers";

let pool: Pool;
beforeAll(async () => {
  pool = testPool();
  await resetSchema(pool);
  await migrateUp(pool);
  await createOrg(pool, "org-admin-test", "Org Admin Test");
  await addToAllowlist(pool, 900000020, "fake");
});
afterAll(() => pool.end());

describe("operator administration", () => {
  it("grants a known role once, audited", async () => {
    expect(await grantRole(pool, 900000020, "org-admin-test", "maintainer")).toBe(true);
    expect(await grantRole(pool, 900000020, "org-admin-test", "maintainer")).toBe(false);
    expect(await listBindings(pool, "org-admin-test")).toEqual([{ githubUserId: 900000020, githubLogin: null, role: "maintainer" }]);
    const a = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'admin.role_granted'");
    expect(a.rows[0].n).toBe(1);
  });

  it("rejects unknown roles, unknown orgs and users not on the allowlist", async () => {
    await expect(grantRole(pool, 900000020, "org-admin-test", "superuser")).rejects.toThrow(/unknown role/);
    await expect(grantRole(pool, 900000020, "no-such-org", "viewer")).rejects.toThrow(/org not found/);
    await expect(grantRole(pool, 900000021, "org-admin-test", "viewer")).rejects.toThrow(/allowlist/);
  });

  it("revokes and audits", async () => {
    expect(await revokeRole(pool, 900000020, "org-admin-test", "maintainer")).toBe(true);
    expect(await revokeRole(pool, 900000020, "org-admin-test", "maintainer")).toBe(false);
    expect(await listBindings(pool, "org-admin-test")).toEqual([]);
    const a = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'admin.role_revoked'");
    expect(a.rows[0].n).toBe(1);
  });

  it("validates org slugs", async () => {
    await expect(createOrg(pool, "Bad Slug", "x")).rejects.toThrow(/slug/);
  });
});
