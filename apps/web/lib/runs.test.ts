import { describe, expect, it } from "vitest";
import { canCancelRun, isValidRunId } from "./runs";

describe("isValidRunId (AC-9c)", () => {
  it("accepts valid UUIDs", () => {
    expect(isValidRunId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isValidRunId("a987fbc9-4bed-4278-9b21-78a7a0b513f4")).toBe(true);
    expect(isValidRunId("A987FBC9-4BED-4278-9B21-78A7A0B513F4")).toBe(true);
  });

  it("rejects non-UUID strings", () => {
    expect(isValidRunId("")).toBe(false);
    expect(isValidRunId("123")).toBe(false);
    expect(isValidRunId("not-a-uuid")).toBe(false);
    expect(isValidRunId("550e8400-e29b-41d4-a716-44665544000")).toBe(false);
    expect(isValidRunId("550e8400-e29b-41d4-a716-446655440000; DROP TABLE runs;")).toBe(false);
    expect(isValidRunId("../../../../etc/passwd")).toBe(false);
  });
});

describe("canCancelRun (AC-9c)", () => {
  it("returns true only when status is QUEUED or RUNNING and permission is granted", () => {
    expect(canCancelRun("QUEUED", true)).toBe(true);
    expect(canCancelRun("RUNNING", true)).toBe(true);
  });

  it("returns false for viewer (permission false) regardless of status", () => {
    expect(canCancelRun("QUEUED", false)).toBe(false);
    expect(canCancelRun("RUNNING", false)).toBe(false);
    expect(canCancelRun("SUCCEEDED", false)).toBe(false);
    expect(canCancelRun("FAILED", false)).toBe(false);
    expect(canCancelRun("CANCELLED", false)).toBe(false);
    expect(canCancelRun("INTERRUPTED", false)).toBe(false);
  });

  it("returns false for terminal statuses even when permission is granted", () => {
    expect(canCancelRun("SUCCEEDED", true)).toBe(false);
    expect(canCancelRun("FAILED", true)).toBe(false);
    expect(canCancelRun("CANCELLED", true)).toBe(false);
    expect(canCancelRun("INTERRUPTED", true)).toBe(false);
  });
});
