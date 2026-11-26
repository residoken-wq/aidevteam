import { describe, expect, it } from "vitest";
import { parsePort } from "../src/config";

describe("parsePort", () => {
  it("uses the fallback when unset or empty", () => {
    expect(parsePort(undefined)).toBe(3001);
    expect(parsePort("")).toBe(3001);
  });

  it("parses a valid port", () => {
    expect(parsePort("8080")).toBe(8080);
  });

  it.each(["0", "65536", "abc", "3001; rm -rf /", "-1", "30.5"])("rejects invalid value %s", (raw) => {
    expect(() => parsePort(raw)).toThrow(/PORT must be/);
  });
});
