import { describe, expect, it } from "vitest";
import { ApprovalListQuerySchema, ApprovalSchema, safeCommentUrl } from "./approval";

describe("safeCommentUrl", () => {
  const validRepo = "owner/repo";
  const validUrl = "https://github.com/owner/repo/pull/123#issuecomment-456789";

  it("returns url when repo matches and url is well-formed", () => {
    expect(safeCommentUrl(validUrl, validRepo)).toBe(validUrl);
  });

  it("returns null when repo is null", () => {
    expect(safeCommentUrl(validUrl, null)).toBeNull();
  });

  it.each([
    ["javascript:alert(1)", "javascript protocol"],
    ["http://github.com/owner/repo/pull/123#issuecomment-456789", "http protocol"],
    ["https://gitlab.com/owner/repo/pull/123#issuecomment-456789", "different domain"],
    ["https://github.com.evil.com/owner/repo/pull/123#issuecomment-456789", "evil subdomain suffix"],
    ["https://github.com/other/repo/pull/123#issuecomment-456789", "different repo"],
    ["https://github.com/owner/repo/pull/123?query=1#issuecomment-456789", "query parameter present"],
    ["https://github.com:443/owner/repo/pull/123#issuecomment-456789", "port present"],
    ["https://user:pass@github.com/owner/repo/pull/123#issuecomment-456789", "userinfo present"],
    ["https://user@github.com/owner/repo/pull/123#issuecomment-456789", "username present"],
    ["https://github.com/owner/repo/pull/abc#issuecomment-456789", "non-numeric PR number"],
    ["https://github.com/owner/repo/pull/123#issuecomment-xyz", "non-numeric comment id"],
    ["https://github.com/owner/repo/pull/123", "missing comment fragment"],
    ["https://github.com/owner/repo/issues/123#issuecomment-456789", "issues instead of pull"],
    ["not a valid url", "invalid url string"],
  ])("returns null for %s (%s)", (url) => {
    expect(safeCommentUrl(url, validRepo)).toBeNull();
  });

  it("is case-sensitive with respect to the configured repo", () => {
    expect(safeCommentUrl("https://github.com/Owner/Repo/pull/1#issuecomment-1", "owner/repo")).toBeNull();
    expect(safeCommentUrl("https://github.com/Owner/Repo/pull/1#issuecomment-1", "Owner/Repo")).toBe(
      "https://github.com/Owner/Repo/pull/1#issuecomment-1",
    );
  });

  it("escapes special regex characters in the repo name", () => {
    const specialRepo = "org.team/repo-name.js";
    const specialUrl = "https://github.com/org.team/repo-name.js/pull/99#issuecomment-888";
    expect(safeCommentUrl(specialUrl, specialRepo)).toBe(specialUrl);
    // Should not treat '.' as wildcard matching 'x'
    const evilUrl = "https://github.com/orgxteam/repo-nameyjs/pull/99#issuecomment-888";
    expect(safeCommentUrl(evilUrl, specialRepo)).toBeNull();
  });
});

describe("ApprovalSchema", () => {
  const validApproval = {
    id: "a0000000-0000-4000-8000-000000000001",
    environment: "uat",
    decision: "approved",
    targetSha: "0123456789abcdef0123456789abcdef01234567",
    releaseManifestDigest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    pipelineRunId: "run-12345",
    approverGithubUserId: 900000099,
    decidedAt: "2026-11-27T10:00:00.000Z",
    recordedAt: "2026-11-27T10:00:01.000Z",
    sourceCommentUrl: "https://github.com/owner/repo/pull/1#issuecomment-123",
  };

  it("accepts valid approval record", () => {
    expect(ApprovalSchema.safeParse(validApproval).success).toBe(true);
    expect(ApprovalSchema.safeParse({ ...validApproval, sourceCommentUrl: null }).success).toBe(true);
    expect(ApprovalSchema.safeParse({ ...validApproval, environment: "production", decision: "rejected" }).success).toBe(true);
  });

  it("rejects unknown fields (strict)", () => {
    expect(ApprovalSchema.safeParse({ ...validApproval, orgId: "extra" }).success).toBe(false);
  });

  it("rejects invalid environment or decision", () => {
    expect(ApprovalSchema.safeParse({ ...validApproval, environment: "staging" }).success).toBe(false);
    expect(ApprovalSchema.safeParse({ ...validApproval, decision: "pending" }).success).toBe(false);
  });
});

describe("ApprovalListQuerySchema", () => {
  it("defaults limit to 50 and offset to 0", () => {
    const q = ApprovalListQuerySchema.parse({});
    expect(q.limit).toBe(50);
    expect(q.offset).toBe(0);
    expect(q.environment).toBeUndefined();
  });

  it("parses valid query parameters with coercion", () => {
    const q = ApprovalListQuerySchema.parse({ environment: "uat", limit: "25", offset: "10" });
    expect(q.environment).toBe("uat");
    expect(q.limit).toBe(25);
    expect(q.offset).toBe(10);
  });

  it("rejects limit out of range", () => {
    expect(ApprovalListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(ApprovalListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(ApprovalListQuerySchema.safeParse({ offset: "-1" }).success).toBe(false);
  });
});
