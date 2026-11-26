import { describe, expect, it } from "vitest";
import { apiInternalUrl } from "./api";
import { loginErrorMessage } from "./login-errors";

describe("loginErrorMessage", () => {
  it.each(["state", "denied", "failed"])("maps %s to a fixed message", (code) => {
    expect(loginErrorMessage(code)).toBeTypeOf("string");
  });

  it("never reflects unknown input (XSS-safe)", () => {
    expect(loginErrorMessage("<script>alert(1)</script>")).toBeNull();
    expect(loginErrorMessage("__proto__")).toBeNull();
    expect(loginErrorMessage(["state"])).toBeNull();
    expect(loginErrorMessage(undefined)).toBeNull();
  });
});

describe("apiInternalUrl", () => {
  it("defaults to the compose service", () => {
    expect(apiInternalUrl({})).toBe("http://api:3001");
  });

  it("rejects non-http schemes and paths", () => {
    expect(() => apiInternalUrl({ API_INTERNAL_URL: "file:///etc/passwd" })).toThrow();
    expect(() => apiInternalUrl({ API_INTERNAL_URL: "http://api:3001/x" })).toThrow();
  });
});
