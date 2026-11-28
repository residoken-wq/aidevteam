import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Pool, PoolClient } from "@aidevteam/db";

export type ProjectAccess = "read" | "write";

/**
 * A user is project-scoped if they only hold project_member (none of the org-wide roles).
 * org_admin, maintainer, viewer retain org-wide access (P2-13 decision A).
 */
export function isProjectScoped(roles: readonly string[]): boolean {
  return !roles.some((r) => r === "org_admin" || r === "maintainer" || r === "viewer");
}

export interface VerifyProjectScopeOptions {
  pool: Pool | PoolClient;
  orgId: string;
  userId: string;
  roles: readonly string[];
  requiredAccess: ProjectAccess;
  projectId?: string;
  projectSlug?: string;
}

/**
 * Common project-scope check for projects/{slug}/** and runs/** (P2-13 §2).
 * - Org-wide roles pass without checking assignments.
 * - project_member requires an assignment on the project:
 *   - Missing assignment -> 404 (pretend the project does not exist)
 *   - Assignment 'read' but requiredAccess 'write' -> 403 Forbidden
 *   - Assignment matching requiredAccess -> passes and returns project id and slug
 */
export async function verifyProjectScope(opts: VerifyProjectScopeOptions): Promise<{ id: string; slug: string }> {
  const { pool, orgId, userId, roles, requiredAccess, projectId, projectSlug } = opts;

  // 1. Resolve project in org
  let projectRow: { id: string; slug: string; archived_at: Date | null } | undefined;
  if (projectId) {
    const r = await pool.query<{ id: string; slug: string; archived_at: Date | null }>(
      "SELECT id, slug, archived_at FROM projects WHERE org_id = $1 AND id = $2",
      [orgId, projectId],
    );
    projectRow = r.rows[0];
  } else if (projectSlug) {
    const r = await pool.query<{ id: string; slug: string; archived_at: Date | null }>(
      "SELECT id, slug, archived_at FROM projects WHERE org_id = $1 AND slug = $2",
      [orgId, projectSlug],
    );
    projectRow = r.rows[0];
  }

  if (!projectRow) {
    throw new NotFoundException();
  }

  // 2. Org-wide roles bypass assignment check
  if (!isProjectScoped(roles)) {
    return { id: projectRow.id, slug: projectRow.slug };
  }

  // 3. Project-scoped user: query assignment
  const assignment = await pool.query<{ access: ProjectAccess }>(
    "SELECT access FROM project_assignments WHERE org_id = $1 AND project_id = $2 AND user_id = $3",
    [orgId, projectRow.id, userId],
  );

  if (!assignment.rows[0]) {
    // AC-1, AC-2, AC-3: unassigned project returns 404
    throw new NotFoundException();
  }

  if (requiredAccess === "write" && assignment.rows[0].access !== "write") {
    // AC-2: read-only assignment attempting write returns 403
    throw new ForbiddenException();
  }

  return { id: projectRow.id, slug: projectRow.slug };
}
