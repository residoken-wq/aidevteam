import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isAllowedTransition,
  TASK_STATUSES,
  TASK_TRANSITIONS,
  TaskActivityQuerySchema,
  TaskCommentCreateSchema,
  TaskCreateSchema,
  TaskListQuerySchema,
  TaskTransitionSchema,
  TaskUpdateSchema,
  type TaskStatus,
} from "./task";

describe("STATE_MACHINES.md §1 mirrors TASK_TRANSITIONS", () => {
  const md = readFileSync(path.join(__dirname, "../../../docs/architecture/STATE_MACHINES.md"), "utf8");
  const section = md.split("## 1. Task")[1]!.split("## 2.")[0]!;
  const pairs = new Set<string>();
  for (const line of section.split("\n")) {
    const m = /^\| ([A-Z_/]+) \| ([A-Z_]+) \|/.exec(line);
    if (!m || m[1] === "Từ") continue;
    for (const from of m[1]!.split("/")) pairs.add(`${from}>${m[2]}`);
  }
  const code = new Set(TASK_STATUSES.flatMap((from) => TASK_TRANSITIONS[from].map((to) => `${from}>${to}`)));

  it("the approved table and the code allow exactly the same transitions", () => {
    expect([...pairs].sort()).toEqual([...code].sort());
  });

  it("DONE and CANCELLED are terminal; nothing skips review into DONE", () => {
    expect(TASK_TRANSITIONS.DONE).toEqual([]);
    expect(TASK_TRANSITIONS.CANCELLED).toEqual([]);
    for (const from of TASK_STATUSES) if (from !== "IN_REVIEW") expect(isAllowedTransition(from as TaskStatus, "DONE")).toBe(false);
  });
});

describe("task contracts", () => {
  it("create trims the title and rejects status, ids and unknown fields", () => {
    expect(TaskCreateSchema.parse({ title: "  Fix login  " }).title).toBe("Fix login");
    expect(TaskCreateSchema.parse({ title: "  Fix login  ", epicSlug: "epic-auth", sprintNumber: 1 })).toEqual({
      title: "Fix login",
      epicSlug: "epic-auth",
      sprintNumber: 1,
    });
    for (const extra of [{ status: "DONE" }, { orgId: "x" }, { projectId: "x" }, { number: 3 }]) {
      expect(TaskCreateSchema.safeParse({ title: "T", ...extra }).success).toBe(false);
    }
  });

  it("update cannot change status and allows updating/clearing epicSlug and sprintNumber", () => {
    expect(TaskUpdateSchema.safeParse({ status: "DONE" }).success).toBe(false);
    expect(TaskUpdateSchema.safeParse({}).success).toBe(false);
    expect(TaskUpdateSchema.safeParse({ agentSlug: null, epicSlug: null, sprintNumber: null }).success).toBe(true);
    expect(TaskUpdateSchema.safeParse({ epicSlug: "new-epic", sprintNumber: 2 }).success).toBe(true);
  });

  it("TaskListQuerySchema validates epic and sprint filters", () => {
    expect(TaskListQuerySchema.parse({ epic: "my-epic", sprint: "3" })).toEqual({
      limit: 200,
      offset: 0,
      epic: "my-epic",
      sprint: 3,
    });
  });

  it("DONE needs confirmReviewed: true; CANCELLED needs a reason; extras are refused elsewhere", () => {
    expect(TaskTransitionSchema.safeParse({ expectedFrom: "IN_REVIEW", to: "DONE" }).success).toBe(false);
    expect(TaskTransitionSchema.safeParse({ expectedFrom: "IN_REVIEW", to: "DONE", confirmReviewed: false }).success).toBe(false);
    expect(TaskTransitionSchema.safeParse({ expectedFrom: "IN_REVIEW", to: "DONE", confirmReviewed: true }).success).toBe(true);
    expect(TaskTransitionSchema.safeParse({ expectedFrom: "TODO", to: "CANCELLED" }).success).toBe(false);
    expect(TaskTransitionSchema.safeParse({ expectedFrom: "TODO", to: "CANCELLED", reason: "  " }).success).toBe(false);
    expect(TaskTransitionSchema.safeParse({ expectedFrom: "TODO", to: "CANCELLED", reason: "duplicate" }).success).toBe(true);
    expect(TaskTransitionSchema.safeParse({ expectedFrom: "TODO", to: "IN_PROGRESS", reason: "x" }).success).toBe(false);
    expect(TaskTransitionSchema.safeParse({ expectedFrom: "TODO", to: "IN_PROGRESS", confirmReviewed: true }).success).toBe(false);
    expect(TaskTransitionSchema.safeParse({ expectedFrom: "TODO", to: "WONTFIX" }).success).toBe(false);
  });

  it("TaskCommentCreateSchema validates body length and rejects empty/whitespace-only/unknown fields", () => {
    expect(TaskCommentCreateSchema.safeParse({ body: "" }).success).toBe(false);
    expect(TaskCommentCreateSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(TaskCommentCreateSchema.safeParse({ body: "Valid comment" }).success).toBe(true);
    expect(TaskCommentCreateSchema.safeParse({ body: "a".repeat(5000) }).success).toBe(true);
    expect(TaskCommentCreateSchema.safeParse({ body: "a".repeat(5001) }).success).toBe(false);
    expect(TaskCommentCreateSchema.safeParse({ body: "Valid", extra: true }).success).toBe(false);
  });

  it("TaskActivityQuerySchema provides defaults and coerces strings", () => {
    expect(TaskActivityQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(TaskActivityQuerySchema.parse({ limit: "25", offset: "10" })).toEqual({ limit: 25, offset: 10 });
    expect(TaskActivityQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(TaskActivityQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
  });
});
