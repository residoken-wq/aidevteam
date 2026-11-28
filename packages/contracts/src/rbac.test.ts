import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, permissionsFor, PLATFORM_PERMISSIONS, ROLE_KEYS, ROLE_PERMISSIONS } from "./rbac";

describe("permissionsFor", () => {
  it("denies everything for no roles or unknown roles", () => {
    expect(permissionsFor([]).size).toBe(0);
    expect(permissionsFor(["superuser", "ORG_ADMIN", ""]).size).toBe(0);
  });

  it("viewer cannot write, dispatch or read audit", () => {
    const p = permissionsFor(["viewer"]);
    expect([...p].some((x) => x.endsWith(":write"))).toBe(false);
    expect(p.has("dispatch:execute")).toBe(false);
    expect(p.has("audit:read")).toBe(false);
    expect(p.has("member:read")).toBe(false);
    expect(p.has("member:write")).toBe(false);
  });

  it("only org_admin can read audit or manage members", () => {
    expect(ROLE_KEYS.filter((r) => ROLE_PERMISSIONS[r].has("audit:read"))).toEqual(["org_admin"]);
    expect(ROLE_KEYS.filter((r) => ROLE_PERMISSIONS[r].has("member:read"))).toEqual(["org_admin"]);
    expect(ROLE_KEYS.filter((r) => ROLE_PERMISSIONS[r].has("member:write"))).toEqual(["org_admin"]);
    expect(ROLE_KEYS.filter((r) => ROLE_PERMISSIONS[r].has("provider_account:license"))).toEqual(["org_admin"]);
  });

  it("roles are nested viewer ⊂ maintainer ⊂ org_admin", () => {
    for (const p of ROLE_PERMISSIONS.viewer) expect(ROLE_PERMISSIONS.maintainer.has(p)).toBe(true);
    for (const p of ROLE_PERMISSIONS.maintainer) expect(ROLE_PERMISSIONS.org_admin.has(p)).toBe(true);
  });
});

describe("docs/governance/RBAC_MATRIX.md mirrors the code", () => {
  const md = readFileSync(path.join(__dirname, "../../../docs/governance/RBAC_MATRIX.md"), "utf8");
  const rows = md
    .split("\n")
    .filter((l) => /^\| `[a-z_]+:[a-z_]+` \|/.test(l))
    .map((l) => l.split("|").map((c) => c.trim()));

  it("lists every permission exactly once", () => {
    expect(rows.map((r) => r[1]!.replace(/`/g, "")).sort()).toEqual([...PERMISSIONS].sort());
  });

  it.each(ROLE_KEYS.map((r, i) => [r, i] as const))("column %s matches ROLE_PERMISSIONS", (role, i) => {
    for (const r of rows) {
      const perm = r[1]!.replace(/`/g, "") as (typeof PERMISSIONS)[number];
      const cell = r[2 + i]!;
      expect(cell === "✅", `${role} / ${perm}`).toBe(ROLE_PERMISSIONS[role].has(perm));
    }
  });
});

describe("RBAC_MATRIX.md platform section mirrors the code", () => {
  it("lists every platform permission exactly once", () => {
    const md = readFileSync(path.join(__dirname, "../../../docs/governance/RBAC_MATRIX.md"), "utf8");
    const rows = md.split("\n").filter((l) => /^\| `platform:[a-z_]+:[a-z_]+` \|/.test(l));
    expect(rows.map((l) => l.split("|")[1]!.trim().replace(/`/g, "")).sort()).toEqual([...PLATFORM_PERMISSIONS].sort());
  });
});
