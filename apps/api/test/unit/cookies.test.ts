import { describe, expect, it } from "vitest";
import { parseCookies } from "../../src/cookies";

describe("parseCookies", () => {
  it("parses pairs and keeps the first occurrence", () => {
    const c = parseCookies("a=1; b=two; a=3");
    expect(c.get("a")).toBe("1");
    expect(c.get("b")).toBe("two");
  });

  it("ignores malformed pairs and undecodable values", () => {
    const c = parseCookies("=x; novalue; ok=%E0%A4%A; good=1");
    expect(c.has("ok")).toBe(false);
    expect(c.get("good")).toBe("1");
  });

  it("handles a missing header", () => {
    expect(parseCookies(undefined).size).toBe(0);
  });
});
