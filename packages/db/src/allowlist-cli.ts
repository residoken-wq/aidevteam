#!/usr/bin/env node
/**
 *   node dist/allowlist-cli.js add <github_user_id> [note]
 *   node dist/allowlist-cli.js remove <github_user_id>
 * Reads DATABASE_URL from the environment; never prints it.
 */
import { addToAllowlist, parseGithubUserId, removeFromAllowlist } from "./allowlist";
import { createPool } from "./client";

async function main(): Promise<void> {
  const [cmd, idRaw, ...noteParts] = process.argv.slice(2);
  if (cmd !== "add" && cmd !== "remove") throw new Error("usage: allowlist-cli.js add <github_user_id> [note] | remove <github_user_id>");
  const id = parseGithubUserId(idRaw);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = createPool(url, { max: 1 });
  try {
    if (cmd === "add") {
      console.warn((await addToAllowlist(pool, id, noteParts.join(" "))) ? `added ${id}` : `${id} already allowlisted`);
    } else {
      console.warn((await removeFromAllowlist(pool, id)) ? `removed ${id} and revoked its sessions` : `${id} was not allowlisted`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("allowlist failed:", err instanceof Error ? err.message : "unknown error");
  process.exit(1);
});
