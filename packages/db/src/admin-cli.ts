#!/usr/bin/env node
/**
 * Operator CLI (reads DATABASE_URL; never prints it). Every change is audited.
 *   node dist/admin-cli.js org create <slug> <name...>
 *   node dist/admin-cli.js role grant  <github_user_id> <org_slug> <org_admin|maintainer|viewer>
 *   node dist/admin-cli.js role revoke <github_user_id> <org_slug> <role>
 *   node dist/admin-cli.js role list   <org_slug>
 *   node dist/admin-cli.js platform grant  <github_user_id> [note...]
 *   node dist/admin-cli.js platform revoke <github_user_id>
 *   node dist/admin-cli.js platform list
 */
import { createOrg, grantPlatformAdmin, grantRole, listBindings, listPlatformAdmins, revokePlatformAdmin, revokeRole } from "./admin";
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
    } else if (area === "platform" && cmd === "grant" && rest.length >= 1) {
      const changed = await grantPlatformAdmin(pool, parseGithubUserId(rest[0]), rest.length > 1 ? rest.slice(1).join(" ") : undefined);
      console.warn(changed ? "grant ok" : "no change (already a platform admin)");
    } else if (area === "platform" && cmd === "revoke" && rest.length === 1) {
      console.warn((await revokePlatformAdmin(pool, parseGithubUserId(rest[0]))) ? "revoke ok" : "no change (not a platform admin)");
    } else if (area === "platform" && cmd === "list" && rest.length === 0) {
      console.warn(JSON.stringify(await listPlatformAdmins(pool)));
    } else {
      throw new Error(
        "usage: admin-cli.js org create <slug> <name> | role grant|revoke <github_user_id> <org_slug> <role> | role list <org_slug> | platform grant <github_user_id> [note] | platform revoke <github_user_id> | platform list",
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("admin failed:", err instanceof Error ? err.message : "unknown error");
  process.exit(1);
});
