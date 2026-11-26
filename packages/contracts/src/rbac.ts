/**
 * RBAC for Release 0.1 — single source of truth in code. docs/governance/RBAC_MATRIX.md mirrors it
 * and a test fails if the two diverge. Default deny: anything not listed here is forbidden.
 * Approved by the session user on 26/11/2026 (DECISION_LOG D-2026-11-26-03); Owner confirmation pending.
 */
export const PERMISSIONS = [
  "dashboard:read",
  "org:read",
  "project:read",
  "project:write",
  "agent:read",
  "agent:write",
  "provider_account:read",
  "provider_account:write",
  "worker:read",
  "worker:write",
  "task:read",
  "task:write",
  "dispatch:execute",
  "run:read",
  "approval:read",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_KEYS = ["org_admin", "maintainer", "viewer"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

const READ_ONLY: Permission[] = [
  "dashboard:read",
  "org:read",
  "project:read",
  "agent:read",
  "provider_account:read",
  "worker:read",
  "task:read",
  "run:read",
  "approval:read",
];

const MAINTAINER: Permission[] = [
  ...READ_ONLY,
  "project:write",
  "agent:write",
  "provider_account:write",
  "worker:write",
  "task:write",
  "dispatch:execute",
];

export const ROLE_PERMISSIONS: Readonly<Record<RoleKey, ReadonlySet<Permission>>> = {
  org_admin: new Set<Permission>([...MAINTAINER, "audit:read"]),
  maintainer: new Set<Permission>(MAINTAINER),
  viewer: new Set<Permission>(READ_ONLY),
};

/**
 * Platform permissions (P2-03) belong to operator-granted platform admins (table platform_admins), not to org
 * roles. They cover managing orgs themselves and grant nothing inside an org. Mirrored in RBAC_MATRIX.md §2.
 */
export const PLATFORM_PERMISSIONS = ["platform:org:read", "platform:org:write"] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

/** Union of permissions for the given role keys. Unknown keys contribute nothing (default deny). */
export function permissionsFor(roleKeys: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const key of roleKeys) {
    if (!isRoleKey(key)) continue;
    for (const p of ROLE_PERMISSIONS[key]) out.add(p);
  }
  return out;
}
