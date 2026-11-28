import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DispatchRunSchema,
  isAllowedRunTransition,
  MockOutputSchema,
  RUN_STATUSES,
  RUN_TRANSITIONS,
  RunSchema,
  RunsQuerySchema,
  RunsResponseSchema,
  StatusListQuerySchema,
} from "./run";

describe("STATE_MACHINES.md §2 mirrors RUN_TRANSITIONS", () => {
  const md = readFileSync(path.join(__dirname, "../../../docs/architecture/STATE_MACHINES.md"), "utf8");
  const section = md.split("## 2. Agent run")[1]!.split("## 3.")[0]!;

  it("§2 mentions all statuses and terminal behavior", () => {
    for (const status of RUN_STATUSES) {
      expect(section).toContain(status);
    }
  });

  it("the approved transitions and the code allow exactly the expected transitions", () => {
    expect(RUN_TRANSITIONS.QUEUED).toEqual(["RUNNING", "CANCELLED"]);
    expect(RUN_TRANSITIONS.RUNNING).toEqual(["SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED"]);
    expect(RUN_TRANSITIONS.SUCCEEDED).toEqual([]);
    expect(RUN_TRANSITIONS.FAILED).toEqual([]);
    expect(RUN_TRANSITIONS.CANCELLED).toEqual([]);
    expect(RUN_TRANSITIONS.INTERRUPTED).toEqual([]);
  });

  it("SUCCEEDED, FAILED, CANCELLED, INTERRUPTED are terminal; nothing can transition out of them", () => {
    for (const term of ["SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED"] as const) {
      expect(RUN_TRANSITIONS[term]).toEqual([]);
      for (const to of RUN_STATUSES) {
        expect(isAllowedRunTransition(term, to)).toBe(false);
      }
    }
  });

  it("QUEUED cannot skip straight to SUCCEEDED or FAILED", () => {
    expect(isAllowedRunTransition("QUEUED", "SUCCEEDED")).toBe(false);
    expect(isAllowedRunTransition("QUEUED", "FAILED")).toBe(false);
    expect(isAllowedRunTransition("QUEUED", "INTERRUPTED")).toBe(false);
  });
});

describe("run contracts", () => {
  it("MockOutputSchema accepts valid SUCCESS and FAILED outputs and rejects extras", () => {
    expect(MockOutputSchema.parse({ status: "SUCCESS", summary: "All done" })).toEqual({
      status: "SUCCESS",
      summary: "All done",
    });
    expect(MockOutputSchema.parse({ status: "FAILED", summary: "Something went wrong" })).toEqual({
      status: "FAILED",
      summary: "Something went wrong",
    });

    // Rejects invalid status
    expect(MockOutputSchema.safeParse({ status: "PENDING", summary: "ok" }).success).toBe(false);
    // Rejects extra fields
    expect(MockOutputSchema.safeParse({ status: "SUCCESS", summary: "ok", extra: 1 }).success).toBe(false);
    // Rejects summary > 2000 chars
    expect(MockOutputSchema.safeParse({ status: "SUCCESS", summary: "x".repeat(2001) }).success).toBe(false);
  });

  it("DispatchRunSchema validates workerSlug and rejects extra fields", () => {
    expect(DispatchRunSchema.parse({ workerSlug: "mock-worker-1" })).toEqual({ workerSlug: "mock-worker-1" });
    expect(DispatchRunSchema.safeParse({ workerSlug: "INVALID SLUG" }).success).toBe(false);
    expect(DispatchRunSchema.safeParse({ workerSlug: "valid-slug", extra: true }).success).toBe(false);
  });

  it("RunSchema validates run DTO and refuses orgId", () => {
    const validDto = {
      id: "a0000000-0000-4000-a000-000000000001",
      projectSlug: "proj-1",
      taskNumber: 42,
      workerSlug: "mock-1",
      status: "QUEUED",
      attempt: 1,
      queuedAt: "2026-11-27T08:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      outputSummary: null,
      log: null,
      errorCode: null,
    };
    expect(RunSchema.parse(validDto)).toEqual(validDto);

    // Refuses orgId
    expect(RunSchema.safeParse({ ...validDto, orgId: "a0000000-0000-4000-a000-000000000000" }).success).toBe(false);
  });

  it("StatusListQuerySchema parses single, comma-separated, and array statuses", () => {
    expect(StatusListQuerySchema.parse("QUEUED")).toEqual(["QUEUED"]);
    expect(StatusListQuerySchema.parse("QUEUED,RUNNING")).toEqual(["QUEUED", "RUNNING"]);
    expect(StatusListQuerySchema.parse(["QUEUED", "RUNNING"])).toEqual(["QUEUED", "RUNNING"]);
    expect(StatusListQuerySchema.parse(["QUEUED,RUNNING", "FAILED"])).toEqual(["QUEUED", "RUNNING", "FAILED"]);
    expect(StatusListQuerySchema.parse(undefined)).toBeUndefined();
    expect(StatusListQuerySchema.parse("")).toBeUndefined();

    // Rejects invalid status
    expect(StatusListQuerySchema.safeParse("INVALID").success).toBe(false);
    expect(StatusListQuerySchema.safeParse("QUEUED,INVALID").success).toBe(false);
    expect(StatusListQuerySchema.safeParse(["INVALID"]).success).toBe(false);
  });

  it("RunsQuerySchema applies defaults, validates limits, and rejects unknown fields", () => {
    expect(RunsQuerySchema.parse({})).toEqual({
      limit: 50,
      offset: 0,
    });

    expect(
      RunsQuerySchema.parse({
        limit: "100",
        offset: "10",
        status: "QUEUED,RUNNING",
        project: "alpha-proj",
        worker: "mock-worker",
      }),
    ).toEqual({
      limit: 100,
      offset: 10,
      status: ["QUEUED", "RUNNING"],
      project: "alpha-proj",
      worker: "mock-worker",
    });

    // Limit > 100 is rejected (P3-09 decision 1: limit <= 100)
    expect(RunsQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(RunsQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(RunsQuerySchema.safeParse({ offset: "-1" }).success).toBe(false);
    // Invalid slug
    expect(RunsQuerySchema.safeParse({ project: "INVALID SLUG" }).success).toBe(false);
    expect(RunsQuerySchema.safeParse({ worker: "INVALID WORKER" }).success).toBe(false);
    // Extra fields rejected (.strict())
    expect(RunsQuerySchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it("RunsResponseSchema validates total and items", () => {
    const valid = {
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    };
    expect(RunsResponseSchema.parse(valid)).toEqual(valid);
    expect(RunsResponseSchema.safeParse({ ...valid, total: -1 }).success).toBe(false);
    expect(RunsResponseSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });
});
