#!/usr/bin/env node
/**
 * Operator CLI (reads DATABASE_URL; never prints it). Every change is audited.
 *   node dist/admin-cli.js org create <slug> <name...>
 *   node dist/admin-cli.js role grant  <github_user_id> <org_slug> <org_admin|maintainer|viewer>
 *   node dist/admin-cli.js role revoke <github_user_id> <org_slug> <role>
 *   node dist/admin-cli.js role list   <org_slug>
 */
import { createOrg, grantRole, listBindings, revokeRole } from "./admin";
import { parseGithubUserId } from "./allowlist";
import { createPool } from "./client";

async function main(): Promise<void> {
  const [area, cmd, ...rest] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = createPool(url, { max: 1 });
  try {
    if (area === "org" && cmd === "create" && rest.length >= 2) {
      const id = await createOrg(pool, rest[0]!, rest.slice(1).join(" "));
      console.warn(`created org ${rest[0]} (${id})`);
    } else if (area === "role" && (cmd === "grant" || cmd === "revoke") && rest.length === 3) {
      const id = parseGithubUserId(rest[0]);
      const changed = cmd === "grant" ? await grantRole(pool, id, rest[1]!, rest[2]!) : await revokeRole(pool, id, rest[1]!, rest[2]!);
      console.warn(changed ? `${cmd} ok` : `no change (${cmd === "grant" ? "already granted" : "binding not found"})`);
    } else if (area === "role" && cmd === "list" && rest.length === 1) {
      console.warn(JSON.stringify(await listBindings(pool, rest[0]!)));
    } else {
      throw new Error("usage: admin-cli.js org create <slug> <name> | role grant|revoke <github_user_id> <org_slug> <role> | role list <org_slug>");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("admin failed:", err instanceof Error ? err.message : "unknown error");
  process.exit(1);
});
