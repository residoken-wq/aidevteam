import type { Request } from "express";
import type { OrgContext, OrgMembership } from "./rbac.service";

export interface AuthContext {
  sessionId: string;
  userId: string;
  githubUserId: number;
  githubLogin: string | null;
  memberships: OrgMembership[];
  /** Operator-granted platform admin (P2-03); re-read on every request. Grants nothing inside an org. */
  platformAdmin: boolean;
  /** Null when the user has no role, or several orgs and none selected. */
  org: OrgContext | null;
}

const KEY = Symbol("aidevteam.auth");

export function setAuth(req: Request, ctx: AuthContext): void {
  (req as unknown as Record<symbol, AuthContext>)[KEY] = ctx;
}

export function getAuth(req: Request): AuthContext {
  const ctx = (req as unknown as Record<symbol, AuthContext | undefined>)[KEY];
  if (!ctx) throw new Error("auth context missing — route must be guarded");
  return ctx;
}

/** For permission-guarded handlers: the org is guaranteed by RbacGuard. */
export function getOrg(req: Request): OrgContext {
  const org = getAuth(req).org;
  if (!org) throw new Error("org context missing — route must require a permission");
  return org;
}
