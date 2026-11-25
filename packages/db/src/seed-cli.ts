#!/usr/bin/env node
import { createPool } from "./client";
import { seed } from "./seed";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = createPool(url, { max: 1 });
  try {
    await seed(pool);
    console.warn("seeded fake data");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("seed failed:", err instanceof Error ? err.message : "unknown error");
  process.exit(1);
});
