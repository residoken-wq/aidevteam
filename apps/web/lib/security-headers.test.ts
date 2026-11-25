import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers";

const byKey = new Map(securityHeaders.map((h) => [h.key.toLowerCase(), h.value]));

describe("securityHeaders", () => {
  it("blocks MIME sniffing", () => {
    expect(byKey.get("x-content-type-options")).toBe("nosniff");
  });

  it("blocks framing (clickjacking)", () => {
    expect(byKey.get("x-frame-options")).toBe("DENY");
    expect(byKey.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("disables plugins/object embedding", () => {
    expect(byKey.get("content-security-policy")).toContain("object-src 'none'");
  });

  it("has no duplicate header keys", () => {
    expect(byKey.size).toBe(securityHeaders.length);
  });
});
