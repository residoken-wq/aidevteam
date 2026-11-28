import { ROLE_PERMISSIONS } from "@aidevteam/contracts";
import { describe, expect, it } from "vitest";
import { navItems, navSections } from "./nav";
import type { Me } from "./server-api";

function fakeMe(opts: {
  roles?: string[];
  permissions?: string[];
  hasActiveOrg?: boolean;
  platformPermissions?: string[];
}): Me {
  const { roles = [], permissions = [], hasActiveOrg = true, platformPermissions = [] } = opts;
  return {
    githubUserId: 900000001,
    githubLogin: "test-user-01",
    orgs: hasActiveOrg ? [{ slug: "test-org", roles }] : [],
    activeOrg: hasActiveOrg
      ? {
          slug: "test-org",
          roles,
          permissions,
        }
      : null,
    platformPermissions,
  };
}

describe("navItems (AC-1)", () => {
  it("returns all 8 main nav links for org_admin", () => {
    const perms = Array.from(ROLE_PERMISSIONS.org_admin);
    const me = fakeMe({ roles: ["org_admin"], permissions: perms });
    const items = navItems(me);

    expect(items.map((i) => i.label)).toEqual([
      "Tổng quan",
      "Dự án",
      "Agent",
      "Tài khoản provider",
      "Worker",
      "Lượt chạy",
      "Duyệt release",
      "Thành viên",
    ]);
    expect(items.every((i) => i.section === "main")).toBe(true);
  });

  it("returns 7 main links for maintainer (excludes Thành viên)", () => {
    const perms = Array.from(ROLE_PERMISSIONS.maintainer);
    const me = fakeMe({ roles: ["maintainer"], permissions: perms });
    const items = navItems(me);

    expect(items.map((i) => i.label)).toEqual([
      "Tổng quan",
      "Dự án",
      "Agent",
      "Tài khoản provider",
      "Worker",
      "Lượt chạy",
      "Duyệt release",
    ]);
    expect(items.map((i) => i.href)).not.toContain("/members");
  });

  it("returns 7 main links for viewer (excludes Thành viên and Quản trị tổ chức)", () => {
    const perms = Array.from(ROLE_PERMISSIONS.viewer);
    const me = fakeMe({ roles: ["viewer"], permissions: perms });
    const items = navItems(me);

    expect(items.map((i) => i.label)).toEqual([
      "Tổng quan",
      "Dự án",
      "Agent",
      "Tài khoản provider",
      "Worker",
      "Lượt chạy",
      "Duyệt release",
    ]);
    expect(items.map((i) => i.href)).not.toContain("/members");
    expect(items.map((i) => i.href)).not.toContain("/platform/orgs");
  });

  it("returns empty list when user has no active org and no platform permissions", () => {
    const me = fakeMe({ hasActiveOrg: false });
    expect(navItems(me)).toEqual([]);
  });

  it("returns only platform links when platform admin has no active org", () => {
    const me = fakeMe({
      hasActiveOrg: false,
      platformPermissions: ["platform:org:read"],
    });
    const items = navItems(me);

    expect(items).toEqual([
      { href: "/platform/orgs", label: "Quản trị tổ chức", section: "platform" },
    ]);
  });

  it("combines org links and platform link when platform admin also has an active org", () => {
    const perms = Array.from(ROLE_PERMISSIONS.viewer);
    const me = fakeMe({
      roles: ["viewer"],
      permissions: perms,
      platformPermissions: ["platform:org:read"],
    });
    const items = navItems(me);

    expect(items.map((i) => i.label)).toEqual([
      "Tổng quan",
      "Dự án",
      "Agent",
      "Tài khoản provider",
      "Worker",
      "Lượt chạy",
      "Duyệt release",
      "Quản trị tổ chức",
    ]);
    expect(items.find((i) => i.href === "/platform/orgs")?.section).toBe("platform");
  });

  it("returns concise sidebar for project_member (Dự án, Agent, Worker, Lượt chạy)", () => {
    const perms = Array.from(ROLE_PERMISSIONS.project_member);
    const me = fakeMe({ roles: ["project_member"], permissions: perms });
    const items = navItems(me);

    expect(items.map((i) => i.label)).toEqual(["Dự án", "Agent", "Worker", "Lượt chạy"]);
    expect(items.map((i) => i.href)).not.toContain("/dashboard");
    expect(items.map((i) => i.href)).not.toContain("/provider-accounts");
    expect(items.map((i) => i.href)).not.toContain("/approvals");
    expect(items.map((i) => i.href)).not.toContain("/members");
  });

  it("default deny: unknown or strange permissions do not add any links", () => {
    const me = fakeMe({
      roles: ["custom"],
      permissions: ["custom:all", "admin:super", "member:delete", "strange:perm"],
    });
    expect(navItems(me)).toEqual([]);
  });

  it("returns empty array for null user", () => {
    expect(navItems(null)).toEqual([]);
  });
});

describe("navSections", () => {
  it("splits main and platform items correctly", () => {
    const perms = Array.from(ROLE_PERMISSIONS.maintainer);
    const me = fakeMe({
      roles: ["maintainer"],
      permissions: perms,
      platformPermissions: ["platform:org:read"],
    });
    const sections = navSections(me);

    expect(sections.main.map((i) => i.label)).toEqual([
      "Tổng quan",
      "Dự án",
      "Agent",
      "Tài khoản provider",
      "Worker",
      "Lượt chạy",
      "Duyệt release",
    ]);
    expect(sections.platform.map((i) => i.label)).toEqual(["Quản trị tổ chức"]);
  });
});
