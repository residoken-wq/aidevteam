import { SetMetadata } from "@nestjs/common";
import type { Permission, PlatformPermission } from "@aidevteam/contracts";

export const ACCESS_KEY = "aidevteam:access";

export type AccessRule =
  | { kind: "public" }
  | { kind: "authenticated" }
  | { kind: "permission"; permission: Permission }
  | { kind: "platform"; permission: PlatformPermission };

/** No session required (health, OAuth entry points). */
export const Public = () => SetMetadata(ACCESS_KEY, { kind: "public" } satisfies AccessRule);
/** Signed in; no org role required (e.g. /auth/me, choosing the active org). */
export const Authenticated = () => SetMetadata(ACCESS_KEY, { kind: "authenticated" } satisfies AccessRule);
/** Signed in, with an active org in which the user's roles grant `permission`. */
export const RequirePermission = (permission: Permission) => SetMetadata(ACCESS_KEY, { kind: "permission", permission } satisfies AccessRule);
/**
 * Signed in as an operator-granted platform admin (P2-03). Needs no active org and grants nothing inside an org.
 */
export const RequirePlatformPermission = (permission: PlatformPermission) => SetMetadata(ACCESS_KEY, { kind: "platform", permission } satisfies AccessRule);
