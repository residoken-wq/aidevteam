import type { Pool } from "pg";

/**
 * FAKE seed data for development and tests only.
 * GitHub user ids in the 900000000 range and "test-" logins make it obvious the data is not real.
 */
export const SEED = {
  orgs: [
    { slug: "org-test-a", name: "Org Test A" },
    { slug: "org-test-b", name: "Org Test B" },
  ],
  users: [
    { githubUserId: 900000001, githubLogin: "test-user-01" },
    { githubUserId: 900000002, githubLogin: "test-user-02" },
  ],
} as const;

export function assertSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production") throw new Error("refusing to seed fake data when NODE_ENV=production");
}

/** Idempotent: running twice inserts nothing new. */
export async function seed(pool: Pool, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  assertSeedAllowed(env);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const o of SEED.orgs) {
      await client.query("INSERT INTO orgs (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING", [o.slug, o.name]);
    }
    for (const u of SEED.users) {
      await client.query("INSERT INTO users (github_user_id, github_login) VALUES ($1, $2) ON CONFLICT (github_user_id) DO NOTHING", [
        u.githubUserId,
        u.githubLogin,
      ]);
      await client.query("INSERT INTO user_allowlist (github_user_id, note) VALUES ($1, $2) ON CONFLICT (github_user_id) DO NOTHING", [
        u.githubUserId,
        "fake seed user",
      ]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
