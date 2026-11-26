import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli";
import { assertSeedAllowed } from "../../src/seed";

describe("migration CLI arguments", () => {
  it("accepts status and up", () => {
    expect(parseArgs(["status"])).toEqual({ cmd: "status" });
    expect(parseArgs(["up"])).toEqual({ cmd: "up" });
  });

  it("requires explicit confirmation for down", () => {
    expect(() => parseArgs(["down", "1"])).toThrow(/--yes-destroy-data/);
    expect(parseArgs(["down", "1", "--yes-destroy-data"])).toEqual({ cmd: "down", steps: 1 });
  });

  it.each([["down", "0", "--yes-destroy-data"], ["down", "-1", "--yes-destroy-data"], ["down", "x", "--yes-destroy-data"], ["drop"], []])(
    "rejects %j",
    (...argv) => {
      expect(() => parseArgs(argv)).toThrow();
    },
  );
});

describe("seed guard", () => {
  it("refuses to seed fake data in production", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(/refusing/);
    expect(() => assertSeedAllowed({ NODE_ENV: "test" })).not.toThrow();
  });
});
