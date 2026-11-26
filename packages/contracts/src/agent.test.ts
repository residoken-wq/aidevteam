import { describe, expect, it } from "vitest";
import { AgentCreateSchema, AgentUpdateSchema } from "./agent";

describe("agent contracts", () => {
  it("accepts a full agent and trims name/title", () => {
    const v = AgentCreateSchema.parse({
      slug: "backend-dev",
      name: " Backend Dev ",
      title: " Engineer ",
      model: "claude-sonnet-x.y",
      providerAccountSlug: "claude-main",
      reportsToSlug: "tech-lead",
    });
    expect(v).toMatchObject({ name: "Backend Dev", title: "Engineer", model: "claude-sonnet-x.y" });
  });

  it.each(["has space", "a;b", "-x", "x".repeat(101), "a$(id)"])("rejects model %j", (model) => {
    expect(AgentCreateSchema.safeParse({ slug: "a-1", name: "A", model }).success).toBe(false);
  });

  it("rejects extra fields such as orgId, promptTemplate or apiKey", () => {
    for (const extra of [{ orgId: "x" }, { promptTemplate: "x" }, { apiKey: "x" }]) {
      expect(AgentCreateSchema.safeParse({ slug: "a-1", name: "A", ...extra }).success).toBe(false);
    }
  });

  it("update needs at least one field, allows clearing references, and refuses slug changes", () => {
    expect(AgentUpdateSchema.safeParse({}).success).toBe(false);
    expect(AgentUpdateSchema.safeParse({ reportsToSlug: null, providerAccountSlug: null, model: null }).success).toBe(true);
    expect(AgentUpdateSchema.safeParse({ slug: "x" }).success).toBe(false);
    expect(AgentUpdateSchema.safeParse({ title: "   " }).success).toBe(false);
  });
});
