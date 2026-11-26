import { describe, expect, it } from "vitest";
import { REDACTED, redact, redactDeep } from "./redact";

// All values below are FAKE and constructed for tests only.
const FAKE = {
  ghToken: "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
  ghoToken: "gho_FAKEFAKEFAKEFAKEFAKEFAKE0000000000",
  pat: "github_pat_" + "11AAAAAAA0aaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbb",
  anthropic: "sk-ant-" + "api03-FAKEfakeFAKEfakeFAKEfake",
  awsKey: "AKIA" + "ABCDEFGHIJKLMNOP",
  googleKey: "AIza" + "SyFAKEfakeFAKEfakeFAKEfakeFAKEfake1".slice(0, 35), // AIza + 35 chars
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJlZmFrZQ",
};

describe("redact — credentials", () => {
  it.each(Object.entries(FAKE))("masks %s", (_name, value) => {
    const out = redact(`value=${value} end`);
    expect(out).not.toContain(value);
    expect(out).toContain(REDACTED);
  });

  it("masks Bearer tokens but keeps the scheme word", () => {
    expect(redact("Authorization: Bearer abcdefghijklmnop.qrstu")).toBe(`Authorization: Bearer ${REDACTED}`);
  });

  it("masks passwords inside connection strings, keeps host for debugging", () => {
    expect(redact("postgres://app:s3cr3t-pass@db.internal:5432/x")).toBe(`postgres://app:${REDACTED}@db.internal:5432/x`);
  });

  it("masks sensitive key=value pairs", () => {
    expect(redact("client_secret=abc123 password: hunter2")).toBe(`client_secret=${REDACTED} password: ${REDACTED}`);
  });

  it("masks PEM private keys", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIfakefakefake\n-----END PRIVATE KEY-----";
    expect(redact(`key:\n${pem}\n`)).toBe(`key:\n${REDACTED}\n`);
  });
});

describe("redact — personal data", () => {
  it("masks emails", () => {
    expect(redact("contact test01@example.com now")).toBe(`contact ${REDACTED} now`);
  });

  it.each(["0912345678", "+84912345678", "84 912 345 678", "0912.345.678", "02838123456"])("masks VN phone %s", (phone) => {
    expect(redact(`call ${phone}.`)).not.toMatch(/\d{3}/);
  });

  it("masks 12-digit CCCD", () => {
    expect(redact("CCCD 001099012345")).toBe(`CCCD ${REDACTED}`);
  });
});

describe("redact — leaves ordinary data alone", () => {
  it.each([
    "github user 900000001 signed in",
    "request 550e8400-e29b-41d4-a716-446655440000",
    "2026-11-26T01:23:45Z",
    "sha256:" + "a".repeat(64),
    "commit 0123456789abcdef0123456789abcdef01234567",
    "env:AIDEV_SECRET_OPENAI",
    "action auth.login_denied reason not_allowlisted",
  ])("keeps %s", (text) => {
    expect(redact(text)).toBe(text);
  });
});

describe("redactDeep", () => {
  it("redacts nested strings and drops values under sensitive keys", () => {
    const input = {
      user: { email: "test02@example.com", githubUserId: 900000002 },
      headers: { authorization: "Bearer xyz", cookie: "__Host-cc_session=abc" },
      list: ["ok", `token ${FAKE.ghToken}`],
      password: "hunter2",
    };
    const out = redactDeep(input) as typeof input;
    expect(out.user.email).toBe(REDACTED);
    expect(out.user.githubUserId).toBe(900000002);
    expect(out.headers.authorization).toBe(REDACTED);
    expect(out.headers.cookie).toBe(REDACTED);
    expect(out.password).toBe(REDACTED);
    expect(JSON.stringify(out)).not.toContain(FAKE.ghToken);
    expect(JSON.stringify(input)).toContain("hunter2"); // input not mutated
  });

  it("handles errors, cycles and depth", () => {
    const a: Record<string, unknown> = { e: new Error("failed for test03@example.com") };
    a.self = a;
    const out = redactDeep(a) as Record<string, unknown>;
    expect(JSON.stringify(out.e)).not.toContain("example.com");
    expect(out.self).toBe("[Circular]");
    let deep: unknown = "x";
    for (let i = 0; i < 20; i++) deep = { d: deep };
    expect(JSON.stringify(redactDeep(deep))).toContain("[Truncated]");
  });
});
