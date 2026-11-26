import { describe, expect, it } from "vitest";
import { WorkerCreateSchema, WorkerUpdateSchema, WorkspacePathSchema, workspacePathsOverlap } from "./worker";

describe("WorkspacePathSchema", () => {
  it.each(["/srv/workers/a", "/home/dev/wt/P2-08", "/opt/aidevteam/ws_1"])("accepts %s", (p) => {
    expect(WorkspacePathSchema.safeParse(p).success).toBe(true);
  });

  it.each(["srv/a", "/srv/../etc", "/srv/./a", "/srv//a", "/srv/a/", "/", "/srv", "/etc/x", "/root/ws", "/proc/1", "/srv/a b", "/srv/.hidden", "C:\\\\ws"])(
    "rejects %j",
    (p) => {
      expect(WorkspacePathSchema.safeParse(p).success).toBe(false);
    },
  );
});

describe("workspacePathsOverlap", () => {
  it.each([
    ["/srv/w/a", "/srv/w/a", true],
    ["/srv/w", "/srv/w/a", true],
    ["/srv/w/a/b", "/srv/w/a", true],
    ["/srv/w/a", "/srv/w/ab", false],
    ["/srv/w/a", "/srv/x/a", false],
  ] as const)("%s vs %s → %s", (a, b, expected) => {
    expect(workspacePathsOverlap(a, b)).toBe(expected);
  });
});

describe("WorkerCreateSchema / WorkerUpdateSchema", () => {
  const valid = { slug: "mock-1", name: "Mock 1", type: "mock", workspacePath: "/srv/workers/mock-1" };
  it("accepts a mock worker and refuses any other type", () => {
    expect(WorkerCreateSchema.safeParse(valid).success).toBe(true);
    for (const type of ["agy", "antigravity", "claude", "real"]) expect(WorkerCreateSchema.safeParse({ ...valid, type }).success).toBe(false);
  });

  it("refuses org id, and changing type or path later", () => {
    expect(WorkerCreateSchema.safeParse({ ...valid, orgId: "x" }).success).toBe(false);
    expect(WorkerUpdateSchema.safeParse({ type: "mock" }).success).toBe(false);
    expect(WorkerUpdateSchema.safeParse({ workspacePath: "/srv/workers/other" }).success).toBe(false);
    expect(WorkerUpdateSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(WorkerUpdateSchema.safeParse({}).success).toBe(false);
  });
});
