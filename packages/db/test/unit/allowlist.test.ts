import { describe, expect, it } from "vitest";
import { parseGithubUserId } from "../../src/allowlist";

describe("parseGithubUserId", () => {
  it("accepts numeric ids", () => {
    expect(parseGithubUserId("900000001")).toBe(900000001);
  });

  it.each(["octocat", "0", "-1", "1e9", "", "12; DROP TABLE users", "99999999999999999"])("rejects %j", (raw) => {
    expect(() => parseGithubUserId(raw)).toThrow();
  });
});
