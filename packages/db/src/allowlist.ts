import type { Pool } from "pg";

/**
 * Operator-only management of the sign-in allowlist (ADR-005). Every change is audited.
 * Being on the allowlist only allows signing in; it grants no role (RBAC is separate, P1-06).
 */
export function parseGithubUserId(raw: string | undefined): number {
  if (!raw || !/^[1-9]\d{0,15}$/.test(raw)) throw new Error("github user id must be a positive integer (numeric id, not the login)");
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) throw new Error("github user id is out of range");
  return id;
}

export async function addToAllowlist(pool: Pool, githubUserId: number, note: string): Promise<boolean> {
  if (note.length > 200) throw new Error("note must be at most 200 characters");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, $2) ON CONFLICT (github_user_id) DO NOTHING", [githubUserId, note || null]);
    if (r.rowCount === 1) {
      await client.query("INSERT INTO audit_events (action, target_type, target_id, metadata) VALUES ('admin.allowlist_added', 'github_user', $1, $2)", [
        String(githubUserId),
        JSON.stringify({ source: "cli" }),
      ]);
    }
    await client.query("COMMIT");
    return r.rowCount === 1;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Removes the entry and revokes that user's active sessions in the same transaction. */
export async function removeFromAllowlist(pool: Pool, githubUserId: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("DELETE FROM user_allowlist WHERE github_user_id = $1", [githubUserId]);
    if (r.rowCount === 1) {
      await client.query(
        "UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE github_user_id = $1)",
        [githubUserId],
      );
      await client.query("INSERT INTO audit_events (action, target_type, target_id, metadata) VALUES ('admin.allowlist_removed', 'github_user', $1, $2)", [
        String(githubUserId),
        JSON.stringify({ source: "cli" }),
      ]);
    }
    await client.query("COMMIT");
    return r.rowCount === 1;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
