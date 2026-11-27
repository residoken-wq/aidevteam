import { describe, expect, it } from "vitest";
import { DashboardSchema, RecentRunSchema, type RecentRun } from "./dashboard";
import { RUN_STATUSES, type RunStatus } from "./run";
import { TASK_STATUSES, type TaskStatus } from "./task";

function validDashboard() {
  const tasks = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
  const runs7d = Object.fromEntries(RUN_STATUSES.map((s) => [s, 0])) as Record<RunStatus, number>;
  return {
    projects: { active: 3 },
    agents: { enabled: 2, disabled: 1 },
    workers: { enabled: 4, disabled: 0 },
    tasks,
    runs7d,
    recentRuns: [
      {
        id: "a0000000-0000-4000-8000-000000000001",
        projectSlug: "proj-alpha",
        taskNumber: 1,
        status: "SUCCEEDED" as const,
        finishedAt: "2026-11-27T10:00:00.000Z",
      },
    ] as RecentRun[],
  };
}

describe("DashboardSchema", () => {
  it("parses valid dashboard object and RecentRunSchema", () => {
    const data = validDashboard();
    expect(RecentRunSchema.safeParse(data.recentRuns[0]).success).toBe(true);
    const parsed = DashboardSchema.parse(data);
    expect(parsed.projects.active).toBe(3);
    expect(parsed.recentRuns).toHaveLength(1);
    expect(parsed.recentRuns[0]?.projectSlug).toBe("proj-alpha");
  });

  it("fails if any task status is missing", () => {
    for (const status of TASK_STATUSES) {
      const data = validDashboard();
      delete (data.tasks as Record<string, number>)[status];
      expect(DashboardSchema.safeParse(data).success).toBe(false);
    }
  });

  it("fails if extra/unknown task status is present", () => {
    const data = validDashboard();
    (data.tasks as Record<string, number>)["UNKNOWN_STATUS"] = 1;
    expect(DashboardSchema.safeParse(data).success).toBe(false);
  });

  it("fails if any run status is missing in runs7d", () => {
    for (const status of RUN_STATUSES) {
      const data = validDashboard();
      delete (data.runs7d as Record<string, number>)[status];
      expect(DashboardSchema.safeParse(data).success).toBe(false);
    }
  });

  it("fails if extra/unknown run status is present in runs7d", () => {
    const data = validDashboard();
    (data.runs7d as Record<string, number>)["UNKNOWN_RUN"] = 1;
    expect(DashboardSchema.safeParse(data).success).toBe(false);
  });

  it("fails if root contains unknown fields like orgId, log, summary, audit", () => {
    const extras = [
      { orgId: "org-1" },
      { log: "some log" },
      { summary: "some summary" },
      { audit: true },
      { extra: 123 },
    ];
    for (const extra of extras) {
      const data = { ...validDashboard(), ...extra };
      expect(DashboardSchema.safeParse(data).success).toBe(false);
    }
  });

  it("fails if recentRuns contains unknown fields like log, summary, orgId", () => {
    const extras = [{ log: "log" }, { summary: "summary" }, { orgId: "123" }];
    for (const extra of extras) {
      const data = validDashboard();
      data.recentRuns = [
        {
          id: "a0000000-0000-4000-8000-000000000001",
          projectSlug: "alpha",
          taskNumber: 1,
          status: "SUCCEEDED" as const,
          finishedAt: null,
          ...extra,
        } as unknown as { id: string; projectSlug: string; taskNumber: number; status: "SUCCEEDED"; finishedAt: null },
      ];
      expect(DashboardSchema.safeParse(data).success).toBe(false);
    }
  });

  it("fails if recentRuns has more than 5 items", () => {
    const data = validDashboard();
    data.recentRuns = Array.from({ length: 6 }, (_, i) => ({
      id: `a0000000-0000-4000-8000-00000000000${i}`,
      projectSlug: "alpha",
      taskNumber: i + 1,
      status: "QUEUED" as const,
      finishedAt: null,
    }));
    expect(DashboardSchema.safeParse(data).success).toBe(false);
  });

  it("fails on negative or non-integer counts", () => {
    const data1 = validDashboard();
    data1.projects.active = -1;
    expect(DashboardSchema.safeParse(data1).success).toBe(false);

    const data2 = validDashboard();
    data2.agents.enabled = 1.5;
    expect(DashboardSchema.safeParse(data2).success).toBe(false);

    const data3 = validDashboard();
    data3.tasks.BACKLOG = -5;
    expect(DashboardSchema.safeParse(data3).success).toBe(false);
  });
});
