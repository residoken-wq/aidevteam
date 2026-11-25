import { describe, expect, it } from "vitest";
import { HealthResponseSchema } from "./health";

describe("HealthResponseSchema", () => {
  it("accepts a minimal ok response", () => {
    expect(HealthResponseSchema.parse({ status: "ok", checks: {} })).toEqual({ status: "ok", checks: {} });
  });

  it("accepts named checks", () => {
    const value = { status: "unavailable", checks: { database: "unavailable" } };
    expect(HealthResponseSchema.parse(value)).toEqual(value);
  });

  it("rejects unknown status values", () => {
    expect(HealthResponseSchema.safeParse({ status: "degraded", checks: {} }).success).toBe(false);
  });

  it("rejects extra fields that could leak internals", () => {
    const leaky = { status: "ok", checks: {}, version: "1.2.3", host: "db.internal" };
    expect(HealthResponseSchema.safeParse(leaky).success).toBe(false);
  });

  it("rejects check names outside the allowed pattern", () => {
    expect(HealthResponseSchema.safeParse({ status: "ok", checks: { "db host=10.0.0.1": "ok" } }).success).toBe(false);
  });
});
