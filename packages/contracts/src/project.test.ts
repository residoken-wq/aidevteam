import { describe, expect, it } from "vitest";
import {
  ProjectCreateSchema,
  ProjectListQuerySchema,
  ProjectStatsQuerySchema,
  ProjectStatsResponseSchema,
  ProjectUpdateSchema,
} from "./project";

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

describe("ProjectStatsQuerySchema (P3-08 AC-4, AC-5)", () => {
  it("defaults archived to false", () => {
    expect(ProjectStatsQuerySchema.parse({})).toEqual({ archived: "false" });
  });

  it("accepts archived and includeArchived", () => {
    expect(ProjectStatsQuerySchema.parse({ archived: "true" })).toEqual({ archived: "true" });
    expect(ProjectStatsQuerySchema.parse({ includeArchived: "true" })).toEqual({ archived: "false", includeArchived: "true" });
  });

  it("rejects unknown fields (AC-5)", () => {
    expect(ProjectStatsQuerySchema.safeParse({ unknown: "val" }).success).toBe(false);
    expect(ProjectStatsQuerySchema.safeParse({ org_id: "x" }).success).toBe(false);
  });
});

describe("ProjectStatsResponseSchema (P3-08 AC-4)", () => {
  it("validates valid stats response", () => {
    const data = {
      items: [
        {
          projectSlug: "proj-1",
          projectName: "Project 1",
          counts: {
            BACKLOG: 2,
            TODO: 3,
            IN_PROGRESS: 1,
            IN_REVIEW: 0,
            DONE: 4,
            CANCELLED: 1,
          },
          total: 11,
        },
      ],
    };
    expect(ProjectStatsResponseSchema.safeParse(data).success).toBe(true);
  });
});

