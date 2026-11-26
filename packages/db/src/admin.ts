import { isRoleKey, ROLE_KEYS } from "@aidevteam/contracts";
import type { Pool, PoolClient } from "pg";

/**
 * Operator-only administration (Release 0.1 has no role editor UI — P2-04).
 * Every change is written to audit_events in the same transaction.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

async function audit(c: PoolClient, action: string, orgId: string | null, targetType: string, targetId: string, metadata: Record<string, string>): Promise<void> {
  await c.query("INSERT INTO audit_events (org_id, action, target_type, target_id, metadata) VALUES ($1, $2, $3, $4, $5)", [
    orgId,
    action,
    targetType,
    targetId,
    JSON.stringify({ source: "cli", ...metadata }),
  ]);
}

export async function createOrg(pool: Pool, slug: string, name: string): Promise<string> {
  if (!SLUG_RE.test(slug)) throw new Error("org slug must match ^[a-z0-9][a-z0-9-]{1,62}$");
  if (!name || name.length > 200) throw new Error("org name must be 1-200 characters");
  return tx(pool, async (c) => {
    const r = await c.query<{ id: string }>("INSERT INTO orgs (slug, name) VALUES ($1, $2) RETURNING id", [slug, name]);
    const id = r.rows[0]!.id;
    await audit(c, "admin.org_created", id, "org", id, { slug });
    return id;
  });
}

/**
 * Grant a role in an org to an allowlisted user (identified by numeric GitHub id).
 * The user row is created if they have not signed in yet. Returns false if already granted.
 */
export async function grantRole(pool: Pool, githubUserId: number, orgSlug: string, roleKey: string): Promise<boolean> {
  if (!isRoleKey(roleKey)) throw new Error(`unknown role '${roleKey}'; allowed: ${ROLE_KEYS.join(", ")}`);
  return tx(pool, async (c) => {
    const org = await c.query<{ id: string }>("SELECT id FROM orgs WHERE slug = $1 AND archived_at IS NULL", [orgSlug]);
    if (!org.rows[0]) throw new Error("org not found");
    const orgId = org.rows[0].id;
    const allowed = await c.query("SELECT 1 FROM user_allowlist WHERE github_user_id = $1", [githubUserId]);
    if (allowed.rowCount === 0) throw new Error("user is not on the sign-in allowlist; add them first");
    const user = await c.query<{ id: string }>(
      `INSERT INTO users (github_user_id) VALUES ($1)
       ON CONFLICT (github_user_id) DO UPDATE SET github_user_id = EXCLUDED.github_user_id RETURNING id`,
      [githubUserId],
    );
    const role = await c.query<{ id: string }>(
      `INSERT INTO roles (org_id, key, name) VALUES ($1, $2, $2)
       ON CONFLICT (org_id, key) DO UPDATE SET key = EXCLUDED.key RETURNING id`,
      [orgId, roleKey],
    );
    const bind = await c.query("INSERT INTO role_bindings (org_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [
      orgId,
      user.rows[0]!.id,
      role.rows[0]!.id,
    ]);
    if (bind.rowCount === 1) await audit(c, "admin.role_granted", orgId, "github_user", String(githubUserId), { role: roleKey });
    return bind.rowCount === 1;
  });
}

export async function revokeRole(pool: Pool, githubUserId: number, orgSlug: string, roleKey: string): Promise<boolean> {
  if (!isRoleKey(roleKey)) throw new Error(`unknown role '${roleKey}'`);
  return tx(pool, async (c) => {
    const r = await c.query<{ org_id: string }>(
      `DELETE FROM role_bindings rb USING roles r, orgs o, users u
        WHERE rb.role_id = r.id AND rb.org_id = o.id AND rb.user_id = u.id
          AND o.slug = $1 AND r.key = $2 AND u.github_user_id = $3
       RETURNING rb.org_id`,
      [orgSlug, roleKey, githubUserId],
    );
    if (r.rowCount === 1) await audit(c, "admin.role_revoked", r.rows[0]!.org_id, "github_user", String(githubUserId), { role: roleKey });
    return r.rowCount === 1;
  });
}

export async function listBindings(pool: Pool, orgSlug: string): Promise<Array<{ githubUserId: number; githubLogin: string | null; role: string }>> {
  const r = await pool.query<{ github_user_id: string; github_login: string | null; key: string }>(
    `SELECT u.github_user_id, u.github_login, r.key
       FROM role_bindings rb JOIN roles r ON r.id = rb.role_id JOIN users u ON u.id = rb.user_id JOIN orgs o ON o.id = rb.org_id
      WHERE o.slug = $1 ORDER BY u.github_user_id, r.key`,
    [orgSlug],
  );
  return r.rows.map((x) => ({ githubUserId: Number(x.github_user_id), githubLogin: x.github_login, role: x.key }));
}

/**
 * Platform administrators (P2-03) manage orgs across tenants but get no access to data inside an org.
 * Operator-only: there is deliberately no API/UI path to grant this. The user must be on the allowlist.
 */
export async function grantPlatformAdmin(pool: Pool, githubUserId: number, note?: string): Promise<boolean> {
  if (note !== undefined && note.length > 200) throw new Error("note must be at most 200 characters");
  return tx(pool, async (c) => {
    const allowed = await c.query("SELECT 1 FROM user_allowlist WHERE github_user_id = $1", [githubUserId]);
    if (allowed.rowCount === 0) throw new Error("user is not on the sign-in allowlist; add them first");
    const user = await c.query<{ id: string }>(
      `INSERT INTO users (github_user_id) VALUES ($1)
       ON CONFLICT (github_user_id) DO UPDATE SET github_user_id = EXCLUDED.github_user_id RETURNING id`,
      [githubUserId],
    );
    const r = await c.query("INSERT INTO platform_admins (user_id, note) VALUES ($1, $2) ON CONFLICT DO NOTHING", [user.rows[0]!.id, note ?? null]);
    if (r.rowCount === 1) await audit(c, "admin.platform_admin_granted", null, "github_user", String(githubUserId), {});
    return r.rowCount === 1;
  });
}

export async function revokePlatformAdmin(pool: Pool, githubUserId: number): Promise<boolean> {
  return tx(pool, async (c) => {
    const r = await c.query("DELETE FROM platform_admins pa USING users u WHERE pa.user_id = u.id AND u.github_user_id = $1", [githubUserId]);
    if (r.rowCount === 1) await audit(c, "admin.platform_admin_revoked", null, "github_user", String(githubUserId), {});
    return r.rowCount === 1;
  });
}

export async function listPlatformAdmins(pool: Pool): Promise<Array<{ githubUserId: number; note: string | null }>> {
  const r = await pool.query<{ github_user_id: string; note: string | null }>(
    "SELECT u.github_user_id, pa.note FROM platform_admins pa JOIN users u ON u.id = pa.user_id ORDER BY u.github_user_id",
  );
  return r.rows.map((x) => ({ githubUserId: Number(x.github_user_id), note: x.note }));
}
