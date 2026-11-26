import { HealthResponseSchema } from "@aidevteam/contracts";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /health (web)", () => {
  it("returns a contract-valid ok response that is not cached", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(HealthResponseSchema.parse(await res.json())).toEqual({ status: "ok", checks: {} });
  });
});
