import type { Task } from "@aidevteam/contracts";
import { describe, expect, it } from "vitest";
import {
  buildKanbanQuery,
  filterKanbanTasks,
  hasActiveKanbanFilters,
} from "./kanban-filter";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    projectSlug: "proj-1",
    number: 1,
    title: "Implement login",
    description: "Detailed description",
    status: "BACKLOG",
    priority: "medium",
    agentSlug: "lead",
    epicSlug: "auth",
    sprintNumber: 1,
    requiredCapabilities: ["nodejs"],
    cancelReason: null,
    createdAt: "2026-11-28T00:00:00Z",
    updatedAt: "2026-11-28T00:00:00Z",
    ...overrides,
  };
}

describe("filterKanbanTasks", () => {
  const tasks: Task[] = [
    makeTask({ number: 1, title: "Backend API Auth", priority: "high", agentSlug: "lead" }),
    makeTask({ number: 2, title: "Frontend Login Screen", priority: "medium", agentSlug: "designer" }),
    makeTask({ number: 3, title: "Database migration", priority: "low", agentSlug: null }),
    makeTask({ number: 4, title: "Auth integration test", priority: "high", agentSlug: null }),
  ];

  it("returns all tasks when filters are empty", () => {
    expect(filterKanbanTasks(tasks, {})).toEqual(tasks);
    expect(filterKanbanTasks(tasks, { priority: "", agent: "", q: "" })).toEqual(tasks);
  });

  it("filters by priority", () => {
    const highOnly = filterKanbanTasks(tasks, { priority: "high" });
    expect(highOnly.map((t) => t.number)).toEqual([1, 4]);

    const lowOnly = filterKanbanTasks(tasks, { priority: "low" });
    expect(lowOnly.map((t) => t.number)).toEqual([3]);
  });

  it("filters by assigned agent", () => {
    const leadTasks = filterKanbanTasks(tasks, { agent: "lead" });
    expect(leadTasks.map((t) => t.number)).toEqual([1]);
  });

  it("filters by unassigned agent (unassigned or none)", () => {
    const unassigned1 = filterKanbanTasks(tasks, { agent: "unassigned" });
    expect(unassigned1.map((t) => t.number)).toEqual([3, 4]);

    const unassigned2 = filterKanbanTasks(tasks, { agent: "none" });
    expect(unassigned2.map((t) => t.number)).toEqual([3, 4]);
  });

  it("filters by title keyword (q) case-insensitively", () => {
    const authTasks = filterKanbanTasks(tasks, { q: "auth" });
    expect(authTasks.map((t) => t.number)).toEqual([1, 4]);

    const loginTasks = filterKanbanTasks(tasks, { q: "LOGIN" });
    expect(loginTasks.map((t) => t.number)).toEqual([2]);
  });

  it("combines priority, agent, and title keyword filters", () => {
    // high priority AND unassigned
    const highUnassigned = filterKanbanTasks(tasks, { priority: "high", agent: "unassigned" });
    expect(highUnassigned.map((t) => t.number)).toEqual([4]);

    // high priority AND lead agent AND keyword "auth"
    const matched = filterKanbanTasks(tasks, { priority: "high", agent: "lead", q: "api" });
    expect(matched.map((t) => t.number)).toEqual([1]);

    // No match
    const none = filterKanbanTasks(tasks, { priority: "low", agent: "lead" });
    expect(none).toEqual([]);
  });
});

describe("hasActiveKanbanFilters", () => {
  it("returns false when no filter is provided", () => {
    expect(hasActiveKanbanFilters({})).toBe(false);
    expect(hasActiveKanbanFilters({ epic: "", sprint: "", priority: "", agent: "", q: "" })).toBe(false);
  });

  it("returns true when any filter is non-empty", () => {
    expect(hasActiveKanbanFilters({ priority: "high" })).toBe(true);
    expect(hasActiveKanbanFilters({ agent: "lead" })).toBe(true);
    expect(hasActiveKanbanFilters({ q: "auth" })).toBe(true);
    expect(hasActiveKanbanFilters({ epic: "auth" })).toBe(true);
    expect(hasActiveKanbanFilters({ sprint: "1" })).toBe(true);
  });
});

describe("buildKanbanQuery", () => {
  it("omits empty, null, or undefined values", () => {
    expect(buildKanbanQuery({ priority: "high", agent: "", q: undefined })).toBe("priority=high");
    expect(buildKanbanQuery({ priority: "", agent: null })).toBe("");
  });

  it("encodes valid filter values into query string", () => {
    const qs = buildKanbanQuery({ priority: "high", agent: "unassigned", q: "hello world" });
    expect(qs).toBe("priority=high&agent=unassigned&q=hello+world");
  });
});
