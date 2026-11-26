import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMigrations, MigrationError } from "../../src/migrate";

const tmpDirs: string[] = [];
function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mig-"));
  tmpDirs.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("repository migrations", () => {
  it("are contiguous, paired up/down and start at 0001", () => {
    const ms = loadMigrations();
    expect(ms.length).toBeGreaterThan(0);
    ms.forEach((m, i) => {
      expect(m.version).toBe(String(i + 1).padStart(4, "0"));
      expect(m.upSql.trim()).not.toBe("");
      expect(m.downSql.trim()).not.toBe("");
    });
  });

  it("down migrations drop everything their up migration creates (0001)", () => {
    const m = loadMigrations()[0]!;
    const created = [...m.upSql.matchAll(/CREATE TABLE (\w+)/g)].map((x) => x[1]);
    for (const table of created) expect(m.downSql).toContain(`DROP TABLE IF EXISTS ${table};`);
  });
});

describe("loadMigrations validation", () => {
  it("rejects a migration without a down file", () => {
    const dir = dirWith({ "0001_a.up.sql": "SELECT 1;" });
    expect(() => loadMigrations(dir)).toThrow(MigrationError);
  });

  it("rejects invalid file names", () => {
    const dir = dirWith({ "1_a.up.sql": "SELECT 1;", "1_a.down.sql": "SELECT 1;" });
    expect(() => loadMigrations(dir)).toThrow(/invalid migration file name/);
  });

  it("rejects gaps in versions", () => {
    const dir = dirWith({
      "0001_a.up.sql": "SELECT 1;",
      "0001_a.down.sql": "SELECT 1;",
      "0003_c.up.sql": "SELECT 1;",
      "0003_c.down.sql": "SELECT 1;",
    });
    expect(() => loadMigrations(dir)).toThrow(/contiguous/);
  });

  it("rejects two names for the same version", () => {
    const dir = dirWith({ "0001_a.up.sql": "SELECT 1;", "0001_b.down.sql": "SELECT 1;" });
    expect(() => loadMigrations(dir)).toThrow(/two different names/);
  });
});
