import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAllowedTransition, parseTaskSearchStatuses, TASK_STATUSES, TASK_TRANSITIONS, TaskCreateSchema, TaskListQuerySchema, TaskSearchQuerySchema, TaskSearchResponseSchema, TaskTransitionSchema, TaskUpdateSchema, type TaskStatus } from "./task";

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

  describe("TaskSearchQuerySchema (P3-08 AC-1, AC-5)", () => {
    it("parses defaults and valid parameters", () => {
      const parsed = TaskSearchQuerySchema.parse({});
      expect(parsed).toEqual({
        limit: 50,
        offset: 0,
        archived: "false",
      });

      const full = TaskSearchQuerySchema.parse({
        q: "fix % and _",
        project: "my-project",
        agent: "lead-dev",
        status: "TODO,IN_PROGRESS",
        priority: "high",
        limit: "25",
        offset: "10",
      });
      expect(full).toEqual({
        q: "fix % and _",
        project: "my-project",
        agent: "lead-dev",
        status: "TODO,IN_PROGRESS",
        priority: "high",
        limit: 25,
        offset: 10,
        archived: "false",
      });
      expect(parseTaskSearchStatuses(full.status)).toEqual(["TODO", "IN_PROGRESS"]);
    });

    it("parses repeated status parameters and array of status", () => {
      const r1 = TaskSearchQuerySchema.parse({ status: ["TODO", "DONE"] });
      expect(r1.status).toEqual(["TODO", "DONE"]);
      expect(parseTaskSearchStatuses(r1.status)).toEqual(["TODO", "DONE"]);

      const r2 = TaskSearchQuerySchema.parse({ status: ["TODO,IN_PROGRESS", "DONE"] });
      expect(r2.status).toEqual(["TODO,IN_PROGRESS", "DONE"]);
      expect(parseTaskSearchStatuses(r2.status)).toEqual(["TODO", "IN_PROGRESS", "DONE"]);
    });

    it("accepts agent 'none'", () => {
      const parsed = TaskSearchQuerySchema.parse({ agent: "none" });
      expect(parsed.agent).toBe("none");
    });

    it("rejects invalid status (AC-5)", () => {
      expect(TaskSearchQuerySchema.safeParse({ status: "UNKNOWN" }).success).toBe(false);
      expect(TaskSearchQuerySchema.safeParse({ status: "TODO,INVALID" }).success).toBe(false);
      expect(TaskSearchQuerySchema.safeParse({ status: ["INVALID"] }).success).toBe(false);
    });

    it("rejects limit > 100 or limit < 1 (AC-5)", () => {
      expect(TaskSearchQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
      expect(TaskSearchQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    });

    it("rejects unknown fields (AC-5)", () => {
      expect(TaskSearchQuerySchema.safeParse({ extraField: "not_allowed" }).success).toBe(false);
      expect(TaskSearchQuerySchema.safeParse({ org_id: "x" }).success).toBe(false);
    });

    it("rejects q exceeding 100 characters or empty q", () => {
      expect(TaskSearchQuerySchema.safeParse({ q: "" }).success).toBe(false);
      expect(TaskSearchQuerySchema.safeParse({ q: "a".repeat(101) }).success).toBe(false);
      expect(TaskSearchQuerySchema.safeParse({ q: "a".repeat(100) }).success).toBe(true);
    });
  });

  describe("TaskSearchResponseSchema", () => {
    it("validates search response structure", () => {
      const resp = {
        items: [
          {
            projectSlug: "proj-1",
            projectName: "Project 1",
            number: 1,
            title: "Task 1",
            status: "TODO",
            priority: "medium",
            agentSlug: "agent-1",
            updatedAt: new Date().toISOString(),
          },
        ],
        limit: 50,
        offset: 0,
        total: 1,
      };
      expect(TaskSearchResponseSchema.safeParse(resp).success).toBe(true);
    });
  });
});
