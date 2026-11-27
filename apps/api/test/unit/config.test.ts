import { describe, expect, it } from "vitest";
import { loadConfig, parsePort } from "../../src/config";

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

const validEnv = {
  DATABASE_URL: "postgres://app@localhost:5432/aidevteam_dev",
  PUBLIC_BASE_URL: "https://cc.example.com",
  GITHUB_OAUTH_CLIENT_ID: "Iv1.testclientid",
  GITHUB_OAUTH_CLIENT_SECRET: "fake-client-secret-for-tests-only",
};

describe("loadConfig", () => {
  it("derives the callback URL from the public origin", () => {
    const c = loadConfig(validEnv);
    expect(c.github.callbackUrl).toBe("https://cc.example.com/auth/github/callback");
    expect(c.sessionTtlMinutes).toBe(480);
    expect(c.trustedProxies).toEqual([]);
    expect(c.approvalRepo).toBeNull();
  });

  it("parses valid APPROVAL_REPO and defaults invalid/missing to null", () => {
    expect(loadConfig({ ...validEnv, APPROVAL_REPO: "owner/repo" }).approvalRepo).toBe("owner/repo");
    expect(loadConfig({ ...validEnv, APPROVAL_REPO: "org-name/repo.js" }).approvalRepo).toBe("org-name/repo.js");
    expect(loadConfig({ ...validEnv, APPROVAL_REPO: "" }).approvalRepo).toBeNull();
    expect(loadConfig({ ...validEnv, APPROVAL_REPO: "invalid-repo" }).approvalRepo).toBeNull();
    expect(loadConfig({ ...validEnv, APPROVAL_REPO: "too/many/slashes" }).approvalRepo).toBeNull();
    expect(loadConfig({ ...validEnv, APPROVAL_REPO: "owner/with spaces" }).approvalRepo).toBeNull();
  });

  it("parses trusted proxies (NPM server)", () => {
    expect(loadConfig({ ...validEnv, TRUSTED_PROXY_IPS: "192.168.250.10" }).trustedProxies).toEqual(["192.168.250.10"]);
  });

  it.each(["DATABASE_URL", "PUBLIC_BASE_URL", "GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"])("fails closed when %s is missing", (key) => {
    const env: Record<string, string> = { ...validEnv };
    delete env[key];
    expect(() => loadConfig(env)).toThrow(/invalid configuration/);
  });

  it("rejects a non-https public origin and origins with a path", () => {
    expect(() => loadConfig({ ...validEnv, PUBLIC_BASE_URL: "http://cc.example.com" })).toThrow(/https origin/);
    expect(() => loadConfig({ ...validEnv, PUBLIC_BASE_URL: "https://cc.example.com/app" })).toThrow(/https origin/);
  });

  it("never echoes secret values in errors", () => {
    try {
      loadConfig({ ...validEnv, GITHUB_OAUTH_CLIENT_SECRET: "short", SESSION_TTL_MINUTES: "1" });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain("short");
      expect(String(e)).not.toContain(validEnv.DATABASE_URL);
    }
  });

  it("rejects malformed trusted proxy lists", () => {
    expect(() => loadConfig({ ...validEnv, TRUSTED_PROXY_IPS: "evil.example.com" })).toThrow(/TRUSTED_PROXY_IPS/);
  });
});
