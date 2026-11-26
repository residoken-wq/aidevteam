import { describe, expect, it } from "vitest";
import { ProjectCreateSchema, ProjectListQuerySchema, ProjectUpdateSchema } from "./project";

describe("ProjectCreateSchema", () => {
  it("accepts a valid project and trims the name", () => {
    expect(ProjectCreateSchema.parse({ slug: "control-center", name: "  Control Center  " })).toEqual({ slug: "control-center", name: "Control Center" });
  });

  it.each([
    [{ slug: "Bad Slug", name: "x" }],
    [{ slug: "a", name: "x" }],
    [{ slug: "ok-slug", name: "   " }],
    [{ slug: "ok-slug", name: "x".repeat(121) }],
    [{ slug: "ok-slug", name: "x", description: "d".repeat(2001) }],
  ])("rejects %j", (input) => {
    expect(ProjectCreateSchema.safeParse(input).success).toBe(false);
  });

  it("rejects org_id / orgId in the body (tenant scope comes from the session)", () => {
    expect(ProjectCreateSchema.safeParse({ slug: "ok-slug", name: "x", org_id: "00000000-0000-0000-0000-000000000000" }).success).toBe(false);
    expect(ProjectCreateSchema.safeParse({ slug: "ok-slug", name: "x", orgId: "x" }).success).toBe(false);
  });
});

describe("ProjectUpdateSchema", () => {
  it("requires at least one field and forbids changing the slug", () => {
    expect(ProjectUpdateSchema.safeParse({}).success).toBe(false);
    expect(ProjectUpdateSchema.safeParse({ slug: "new-slug" }).success).toBe(false);
    expect(ProjectUpdateSchema.parse({ description: null })).toEqual({ description: null });
  });
});

describe("ProjectListQuerySchema", () => {
  it("defaults and caps the page size", () => {
    expect(ProjectListQuerySchema.parse({})).toEqual({ limit: 50, offset: 0, archived: "false" });
    expect(ProjectListQuerySchema.safeParse({ limit: "1000" }).success).toBe(false);
    expect(ProjectListQuerySchema.safeParse({ org_id: "x" }).success).toBe(false);
  });
});
