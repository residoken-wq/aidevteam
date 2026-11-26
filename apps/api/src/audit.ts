import { redactDeep } from "@aidevteam/contracts";
import type { Pool } from "@aidevteam/db";

export interface AuditEvent {
  action: string;
  orgId?: string | null;
  actorUserId?: string | null;
  actorGithubUserId?: number | null;
  targetType?: string | null;
  targetId?: string | null;
  requestId?: string | null;
  /** Redacted again before storage (defence in depth), but callers must still not put secrets here. */
  metadata?: Record<string, string | number | boolean | null>;
}

export async function writeAudit(pool: Pool, e: AuditEvent): Promise<void> {
  await pool.query(
    `INSERT INTO audit_events (org_id, actor_user_id, actor_github_user_id, action, target_type, target_id, request_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      e.orgId ?? null,
      e.actorUserId ?? null,
      e.actorGithubUserId ?? null,
      e.action,
      e.targetType ?? null,
      e.targetId ?? null,
      e.requestId ?? null,
      JSON.stringify(redactDeep(e.metadata ?? {})),
    ],
  );
}
