#!/usr/bin/env node
/**
 * Migration CLI. Reads DATABASE_URL from the environment; never prints it.
 *   node dist/cli.js status
 *   node dist/cli.js up
 *   node dist/cli.js down <steps> --yes-destroy-data
 */
import { createPool } from "./client";
import { migrateDown, migrateUp, migrationStatus } from "./migrate";

export function parseArgs(argv: string[]): { cmd: "status" | "up" } | { cmd: "down"; steps: number } {
  const [cmd, ...rest] = argv;
  if (cmd === "status" || cmd === "up") {
    if (rest.length) throw new Error(`unexpected arguments for ${cmd}`);
    return { cmd };
  }
  if (cmd === "down") {
    const [stepsRaw, ...flags] = rest;
    if (!stepsRaw || !/^[1-9]\d*$/.test(stepsRaw)) throw new Error("down requires a positive integer number of steps");
    if (flags.length !== 1 || flags[0] !== "--yes-destroy-data") {
      throw new Error("down destroys data; pass --yes-destroy-data to confirm");
    }
    return { cmd, steps: Number(stepsRaw) };
  }
  throw new Error("usage: cli.js status | up | down <steps> --yes-destroy-data");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = createPool(url, { max: 2 });
  try {
    if (args.cmd === "status") {
      const s = await migrationStatus(pool);
      console.warn(JSON.stringify(s));
    } else if (args.cmd === "up") {
      const ran = await migrateUp(pool);
      console.warn(ran.length ? `applied: ${ran.join(", ")}` : "up to date");
    } else if (args.cmd === "down") {
      if (process.env.NODE_ENV === "production") throw new Error("down migrations are disabled when NODE_ENV=production");
      const ran = await migrateDown(pool, args.steps);
      console.warn(`reverted: ${ran.join(", ") || "nothing"}`);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error("migration failed:", err instanceof Error ? err.message : "unknown error");
    process.exit(1);
  });
}
