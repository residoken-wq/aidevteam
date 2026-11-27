import type { Me } from "./server-api";
import { can, canPlatform } from "./server-api";

export interface NavItem {
  href: string;
  label: string;
  section: "main" | "platform";
}

export function navItems(me: Me | null): NavItem[] {
  if (!me) return [];

  const items: NavItem[] = [];

  if (me.activeOrg) {
    if (can(me, "dashboard:read")) {
      items.push({ href: "/dashboard", label: "Tổng quan", section: "main" });
    }
    if (can(me, "project:read")) {
      items.push({ href: "/projects", label: "Dự án", section: "main" });
    }
    if (can(me, "agent:read")) {
      items.push({ href: "/agents", label: "Agent", section: "main" });
    }
    if (can(me, "provider_account:read")) {
      items.push({ href: "/provider-accounts", label: "Tài khoản provider", section: "main" });
    }
    if (can(me, "worker:read")) {
      items.push({ href: "/workers", label: "Worker", section: "main" });
    }
    if (can(me, "approval:read")) {
      items.push({ href: "/approvals", label: "Duyệt release", section: "main" });
    }
    if (can(me, "member:read")) {
      items.push({ href: "/members", label: "Thành viên", section: "main" });
    }
  }

  if (canPlatform(me, "platform:org:read")) {
    items.push({ href: "/platform/orgs", label: "Quản trị tổ chức", section: "platform" });
  }

  return items;
}

export function navSections(me: Me | null): { main: NavItem[]; platform: NavItem[] } {
  const all = navItems(me);
  return {
    main: all.filter((i) => i.section === "main"),
    platform: all.filter((i) => i.section === "platform"),
  };
}
