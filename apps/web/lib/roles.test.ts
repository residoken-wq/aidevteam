import { ROLE_KEYS } from "@aidevteam/contracts";
import { describe, expect, it } from "vitest";
import { roleLabel } from "./roles";

describe("roleLabel", () => {
  it.each(ROLE_KEYS)("has a Vietnamese label for %s", (key) => {
    expect(roleLabel(key)).not.toBe(key);
  });

  it("falls back to the key for unknown roles", () => {
    expect(roleLabel("__proto__")).toBe("__proto__");
  });
});
