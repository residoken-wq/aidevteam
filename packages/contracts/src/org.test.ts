import { describe, expect, it } from "vitest";
import { OrgCreateSchema, OrgUpdateSchema } from "./org";
import { PERMISSIONS, PLATFORM_PERMISSIONS, ROLE_KEYS, ROLE_PERMISSIONS } from "./rbac";

describe("org contracts", () => {
  it("accepts a valid org and trims the name", () => {
    expect(OrgCreateSchema.parse({ slug: "org-test-c", name: "  Org Test C  " })).toEqual({ slug: "org-test-c", name: "Org Test C" });
  });

  it("rejects bad slugs, empty/oversized names and extra fields (no id smuggling)", () => {
    expect(OrgCreateSchema.safeParse({ slug: "Bad Slug", name: "x" }).success).toBe(false);
    expect(OrgCreateSchema.safeParse({ slug: "ok-org", name: "   " }).success).toBe(false);
    expect(OrgCreateSchema.safeParse({ slug: "ok-org", name: "x".repeat(201) }).success).toBe(false);
    expect(OrgCreateSchema.safeParse({ slug: "ok-org", name: "x", id: "u" }).success).toBe(false);
  });

  it("update only allows the name", () => {
    expect(OrgUpdateSchema.safeParse({ name: "New" }).success).toBe(true);
    expect(OrgUpdateSchema.safeParse({ slug: "renamed" }).success).toBe(false);
    expect(OrgUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("platform permissions are separate from org roles", () => {
  it("no org role grants a platform permission", () => {
    for (const role of ROLE_KEYS) for (const p of PLATFORM_PERMISSIONS) expect(ROLE_PERMISSIONS[role].has(p as never)).toBe(false);
    for (const p of PLATFORM_PERMISSIONS) expect((PERMISSIONS as readonly string[]).includes(p)).toBe(false);
  });
});
