import { describe, expect, it } from "vitest";
import {
  LicenseStatusSchema,
  ProviderAccountCreateSchema,
  ProviderAccountLicenseChangeSchema,
  ProviderAccountSchema,
  ProviderAccountUpdateSchema,
} from "./provider-account";

const FAKE_KEY = "sk-ant-" + "api03-FAKEfakeFAKEfakeFAKEfake";
const valid = { slug: "claude-main", name: "Claude main", provider: "anthropic", secretRef: "env:AIDEV_SECRET_CLAUDE_MAIN" };

describe("ProviderAccountCreateSchema", () => {
  it("accepts a reference", () => {
    expect(ProviderAccountCreateSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a pasted credential as secret_like without echoing it", () => {
    const r = ProviderAccountCreateSchema.safeParse({ ...valid, secretRef: FAKE_KEY });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("secret_like");
    expect(JSON.stringify(r.error)).not.toContain(FAKE_KEY);
  });

  it.each([{ provider: "aws" }, { secretRef: "env:DATABASE_URL" }, { orgId: "x" }, { apiKey: FAKE_KEY }, { licenseStatus: "approved" }])("rejects %j", (extra) => {
    expect(ProviderAccountCreateSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
  });
});

describe("providers", () => {
  it.each(["anthropic", "openai", "google", "github", "other"])("accepts %s", (provider) => {
    expect(ProviderAccountCreateSchema.safeParse({ ...valid, provider }).success).toBe(true);
  });
});

describe("ProviderAccountUpdateSchema", () => {
  it("allows rotating the reference but not the provider or slug", () => {
    expect(ProviderAccountUpdateSchema.parse({ secretRef: "file:/run/secrets/claude-new" })).toEqual({ secretRef: "file:/run/secrets/claude-new" });
    expect(ProviderAccountUpdateSchema.safeParse({ provider: "google" }).success).toBe(false);
    expect(ProviderAccountUpdateSchema.safeParse({ slug: "x-y" }).success).toBe(false);
    expect(ProviderAccountUpdateSchema.safeParse({ licenseStatus: "approved" }).success).toBe(false);
    expect(ProviderAccountUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("LicenseStatus and ProviderAccountLicenseChangeSchema (P2-09)", () => {
  it.each(["approved", "unverified", "prohibited"])("LicenseStatusSchema accepts %s", (status) => {
    expect(LicenseStatusSchema.safeParse(status).success).toBe(true);
  });

  it.each(["ok", "invalid", "", "ACTIVE"])("LicenseStatusSchema rejects %s", (status) => {
    expect(LicenseStatusSchema.safeParse(status).success).toBe(false);
  });

  it("ProviderAccountLicenseChangeSchema accepts valid license status", () => {
    expect(ProviderAccountLicenseChangeSchema.parse({ licenseStatus: "approved" })).toEqual({ licenseStatus: "approved" });
  });

  it.each([{ licenseStatus: "ok" }, { licenseStatus: "approved", orgId: "org-1" }, { licenseStatus: "approved", extra: true }, {}])(
    "ProviderAccountLicenseChangeSchema rejects %j (strict)",
    (input) => {
      expect(ProviderAccountLicenseChangeSchema.safeParse(input).success).toBe(false);
    },
  );

  it("ProviderAccountSchema includes licenseStatus", () => {
    const full = {
      ...valid,
      description: null,
      licenseStatus: "unverified",
      createdAt: "2026-11-28T00:00:00.000Z",
      updatedAt: "2026-11-28T00:00:00.000Z",
      archivedAt: null,
    };
    expect(ProviderAccountSchema.parse(full)).toEqual(full);
    expect(ProviderAccountSchema.safeParse({ ...full, licenseStatus: "unknown" }).success).toBe(false);
  });
});
