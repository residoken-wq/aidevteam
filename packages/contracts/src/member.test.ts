import { describe, expect, it } from "vitest";
import { MemberRoleChangeSchema, MemberSchema } from "./member";

describe("MemberSchema", () => {
  it("validates valid member", () => {
    const valid = { githubUserId: 900000001, githubLogin: "test-user-01", roles: ["org_admin", "viewer"] };
    expect(MemberSchema.safeParse(valid).success).toBe(true);
  });

  it("allows null githubLogin", () => {
    const valid = { githubUserId: 900000002, githubLogin: null, roles: ["viewer"] };
    expect(MemberSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unknown keys (strict)", () => {
    const extra = { githubUserId: 900000001, githubLogin: null, roles: ["viewer"], orgId: "fake" };
    expect(MemberSchema.safeParse(extra).success).toBe(false);
  });

  it("rejects unknown role", () => {
    const invalidRole = { githubUserId: 900000001, githubLogin: null, roles: ["superadmin"] };
    expect(MemberSchema.safeParse(invalidRole).success).toBe(false);
  });
});

describe("MemberRoleChangeSchema", () => {
  it("validates positive integer githubUserId and valid role", () => {
    expect(MemberRoleChangeSchema.safeParse({ githubUserId: 900000001, role: "maintainer" }).success).toBe(true);
  });

  it("rejects non-positive or float githubUserId", () => {
    expect(MemberRoleChangeSchema.safeParse({ githubUserId: 0, role: "viewer" }).success).toBe(false);
    expect(MemberRoleChangeSchema.safeParse({ githubUserId: -1, role: "viewer" }).success).toBe(false);
    expect(MemberRoleChangeSchema.safeParse({ githubUserId: 1.5, role: "viewer" }).success).toBe(false);
  });

  it("rejects exceeding Number.MAX_SAFE_INTEGER", () => {
    expect(MemberRoleChangeSchema.safeParse({ githubUserId: Number.MAX_SAFE_INTEGER + 1, role: "viewer" }).success).toBe(false);
  });

  it("rejects invalid role key", () => {
    expect(MemberRoleChangeSchema.safeParse({ githubUserId: 900000001, role: "admin" }).success).toBe(false);
  });

  it("is strict against extra properties", () => {
    expect(MemberRoleChangeSchema.safeParse({ githubUserId: 900000001, role: "viewer", orgSlug: "test" }).success).toBe(false);
    expect(MemberRoleChangeSchema.safeParse({ githubUserId: 900000001, role: "viewer", orgId: "test" }).success).toBe(false);
  });
});
