import { describe, expect, it } from "vitest";
import { checkSecretRef, looksLikeSecret, SecretRefSchema } from "./secret-ref";

describe("secret_ref format", () => {
  it.each(["env:AIDEV_SECRET_OPENAI", "env:AIDEV_SECRET_CLAUDE_KEY_2", "file:/run/secrets/claude-api-key", "file:/run/secrets/a.b_c"])("accepts %s", (ref) => {
    expect(checkSecretRef(ref)).toEqual({ ok: true });
  });

  it.each([
    "env:DATABASE_URL", // Control Center's own variables are never addressable
    "env:GITHUB_OAUTH_CLIENT_SECRET",
    "env:aidev_secret_lower",
    "file:/etc/aidevteam/app.env",
    "file:/run/secrets/../../etc/shadow",
    "vault:kv/data/x",
    "",
    "AIDEV_SECRET_X",
  ])("rejects %j as invalid_format", (ref) => {
    expect(checkSecretRef(ref)).toEqual({ ok: false, problem: "invalid_format" });
  });

  it.each(["ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8", "sk-ant-" + "api03-FAKEfakeFAKEfakeFAKEfake", "Xk9mP2qR7sT4vW8yZ1aB3cD5eF6gH0jK"])(
    "flags a pasted credential as secret_like",
    (value) => {
      expect(checkSecretRef(value)).toEqual({ ok: false, problem: "secret_like" });
    },
  );
});

describe("SecretRefSchema error messages", () => {
  it("never echo the submitted value", () => {
    const secret = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
    const r = SecretRefSchema.safeParse(secret);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).not.toContain(secret);
    expect(JSON.stringify(r.error?.issues)).toContain("secret_like");
  });
});

describe("looksLikeSecret", () => {
  it("does not flag ordinary refs or names", () => {
    expect(looksLikeSecret("env:AIDEV_SECRET_OPENAI")).toBe(false);
    expect(looksLikeSecret("Claude production account")).toBe(false);
  });
});
