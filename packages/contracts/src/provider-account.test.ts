import { describe, expect, it } from "vitest";
import { ProviderAccountCreateSchema, ProviderAccountUpdateSchema } from "./provider-account";

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

  it.each([{ provider: "aws" }, { secretRef: "env:DATABASE_URL" }, { orgId: "x" }, { apiKey: FAKE_KEY }])("rejects %j", (extra) => {
    expect(ProviderAccountCreateSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
  });
});

describe("ProviderAccountUpdateSchema", () => {
  it("allows rotating the reference but not the provider or slug", () => {
    expect(ProviderAccountUpdateSchema.parse({ secretRef: "file:/run/secrets/claude-new" })).toEqual({ secretRef: "file:/run/secrets/claude-new" });
    expect(ProviderAccountUpdateSchema.safeParse({ provider: "google" }).success).toBe(false);
    expect(ProviderAccountUpdateSchema.safeParse({ slug: "x-y" }).success).toBe(false);
    expect(ProviderAccountUpdateSchema.safeParse({}).success).toBe(false);
  });
});
