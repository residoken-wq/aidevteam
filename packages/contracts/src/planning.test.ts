import { describe, expect, it } from "vitest";
import {
  EpicCreateSchema,
  EpicUpdateSchema,
  MilestoneCreateSchema,
  MilestoneUpdateSchema,
  SprintCreateSchema,
  SprintTransitionSchema,
  SprintUpdateSchema,
} from "./planning";

describe("planning contracts (P3-01, AC-2, AC-3)", () => {
  it("EpicCreateSchema validates valid input and rejects malformed fields", () => {
    expect(
      EpicCreateSchema.parse({
        slug: "epic-one",
        title: "  Epic One  ",
        description: "An epic description",
        milestoneSlug: "m-one",
      }),
    ).toEqual({
      slug: "epic-one",
      title: "Epic One",
      description: "An epic description",
      milestoneSlug: "m-one",
    });

    expect(EpicCreateSchema.safeParse({ slug: "INVALID", title: "Valid" }).success).toBe(false);
    expect(EpicCreateSchema.safeParse({ slug: "valid-slug", title: "" }).success).toBe(false);
  });

  it("EpicUpdateSchema requires at least one field and allows clearing milestone/description", () => {
    expect(EpicUpdateSchema.safeParse({}).success).toBe(false);
    expect(EpicUpdateSchema.parse({ milestoneSlug: null, description: null })).toEqual({
      milestoneSlug: null,
      description: null,
    });
  });

  it("MilestoneCreateSchema and MilestoneUpdateSchema validate due dates", () => {
    expect(
      MilestoneCreateSchema.parse({
        slug: "m-1",
        title: "Milestone 1",
        dueDate: "2026-12-31",
      }),
    ).toEqual({
      slug: "m-1",
      title: "Milestone 1",
      dueDate: "2026-12-31",
    });

    expect(MilestoneCreateSchema.safeParse({ slug: "m-1", title: "M", dueDate: "invalid-date" }).success).toBe(false);
    expect(MilestoneUpdateSchema.safeParse({}).success).toBe(false);
    expect(MilestoneUpdateSchema.parse({ dueDate: null })).toEqual({ dueDate: null });
  });

  it("SprintCreateSchema enforces endDate >= startDate", () => {
    expect(
      SprintCreateSchema.parse({
        name: "Sprint 1",
        startDate: "2026-01-01",
        endDate: "2026-01-14",
      }),
    ).toEqual({
      name: "Sprint 1",
      startDate: "2026-01-01",
      endDate: "2026-01-14",
    });

    expect(
      SprintCreateSchema.safeParse({
        name: "Sprint Invalid",
        startDate: "2026-01-15",
        endDate: "2026-01-01",
      }).success,
    ).toBe(false);
  });

  it("SprintUpdateSchema validates dates and rejects empty updates", () => {
    expect(SprintUpdateSchema.safeParse({}).success).toBe(false);
    expect(
      SprintUpdateSchema.safeParse({
        startDate: "2026-02-15",
        endDate: "2026-02-01",
      }).success,
    ).toBe(false);
    expect(SprintUpdateSchema.parse({ name: "Updated Sprint" })).toEqual({ name: "Updated Sprint" });
  });

  it("SprintTransitionSchema only allows ACTIVE or CLOSED", () => {
    expect(SprintTransitionSchema.safeParse({ to: "ACTIVE" }).success).toBe(true);
    expect(SprintTransitionSchema.safeParse({ to: "CLOSED" }).success).toBe(true);
    expect(SprintTransitionSchema.safeParse({ to: "PLANNED" }).success).toBe(false);
    expect(SprintTransitionSchema.safeParse({ to: "OTHER" }).success).toBe(false);
  });
});
