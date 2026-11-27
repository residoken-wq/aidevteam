import { describe, expect, it } from "vitest";
import { buildOrgTree, canDrop, findNode, type OrgAgent } from "./org-tree";

describe("buildOrgTree (AC-1)", () => {
  it("builds multi-level tree sorted by name then slug", () => {
    const agents: OrgAgent[] = [
      { slug: "dev-b", name: "Dev", title: "Backend", reportsToSlug: "lead-tech", enabled: true },
      { slug: "dev-a", name: "Dev", title: "Frontend", reportsToSlug: "lead-tech", enabled: true },
      { slug: "lead-tech", name: "Lead Tech", title: "Tech Lead", reportsToSlug: "manager", enabled: true },
      { slug: "manager", name: "Alice Manager", title: "EM", reportsToSlug: null, enabled: true },
      { slug: "qa-lead", name: "Bob QA", title: "QA Lead", reportsToSlug: "manager", enabled: true },
    ];

    const tree = buildOrgTree(agents);

    // Root should be Alice Manager
    expect(tree).toHaveLength(1);
    expect(tree[0]?.slug).toBe("manager");
    expect(tree[0]?.children).toHaveLength(2);

    // Children of manager sorted by name: "Bob QA" before "Lead Tech"
    expect(tree[0]?.children[0]?.slug).toBe("qa-lead");
    expect(tree[0]?.children[1]?.slug).toBe("lead-tech");

    // Children of Lead Tech: both named "Dev", sorted by slug ("dev-a" before "dev-b")
    const leadChildren = tree[0]?.children[1]?.children;
    expect(leadChildren).toHaveLength(2);
    expect(leadChildren?.[0]?.slug).toBe("dev-a");
    expect(leadChildren?.[1]?.slug).toBe("dev-b");
  });

  it("turns agents with missing or archived manager into roots", () => {
    const agents: OrgAgent[] = [
      { slug: "dev-orphan", name: "Dev Orphan", title: "Dev", reportsToSlug: "archived-lead", enabled: true },
      { slug: "dev-normal", name: "Dev Normal", title: "Dev", reportsToSlug: null, enabled: true },
    ];

    const tree = buildOrgTree(agents);
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.slug)).toEqual(["dev-normal", "dev-orphan"]);
    expect(tree.find((n) => n.slug === "dev-orphan")?.reportsToSlug).toBe("archived-lead");
    expect(tree.find((n) => n.slug === "dev-orphan")?.cycle).toBeUndefined();
  });

  it("handles cyclical data without infinite loops and marks cycle nodes as roots with cycle: true", () => {
    // A -> B -> C -> A
    // Plus D -> A (child of A)
    const agents: OrgAgent[] = [
      { slug: "a", name: "Agent A", reportsToSlug: "b", enabled: true },
      { slug: "b", name: "Agent B", reportsToSlug: "c", enabled: true },
      { slug: "c", name: "Agent C", reportsToSlug: "a", enabled: true },
      { slug: "d", name: "Agent D", reportsToSlug: "a", enabled: true },
    ];

    const tree = buildOrgTree(agents);

    // All cycle nodes (a, b, c) become roots with cycle: true
    expect(tree).toHaveLength(3);
    const slugs = tree.map((n) => n.slug);
    expect(slugs).toEqual(["a", "b", "c"]);

    for (const node of tree) {
      expect(node.cycle).toBe(true);
    }

    // D is not in the cycle, it is a child of A
    const nodeA = tree.find((n) => n.slug === "a");
    expect(nodeA?.children).toHaveLength(1);
    expect(nodeA?.children[0]?.slug).toBe("d");
    expect(nodeA?.children[0]?.cycle).toBeUndefined();
  });

  it("handles self-loop cycle A -> A", () => {
    const agents: OrgAgent[] = [{ slug: "self", name: "Self Agent", reportsToSlug: "self", enabled: true }];

    const tree = buildOrgTree(agents);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.slug).toBe("self");
    expect(tree[0]?.cycle).toBe(true);
    expect(tree[0]?.children).toHaveLength(0);
  });
});

describe("canDrop (AC-1)", () => {
  const agents: OrgAgent[] = [
    { slug: "root", name: "Root", reportsToSlug: null, enabled: true },
    { slug: "lead", name: "Lead", reportsToSlug: "root", enabled: true },
    { slug: "dev-1", name: "Dev 1", reportsToSlug: "lead", enabled: true },
    { slug: "dev-2", name: "Dev 2", reportsToSlug: "lead", enabled: true },
    { slug: "sub-dev", name: "Sub Dev", reportsToSlug: "dev-1", enabled: true },
    { slug: "other-root", name: "Other Root", reportsToSlug: null, enabled: true },
  ];

  const tree = buildOrgTree(agents);

  it("allows dropping onto root (null or empty string)", () => {
    expect(canDrop(tree, "dev-1", null)).toBe(true);
    expect(canDrop(tree, "dev-1", "")).toBe(true);
    expect(canDrop(tree, "root", null)).toBe(true);
  });

  it("blocks dropping onto self", () => {
    expect(canDrop(tree, "lead", "lead")).toBe(false);
    expect(canDrop(tree, "root", "root")).toBe(false);
  });

  it("blocks dropping onto descendants", () => {
    // lead -> dev-1 -> sub-dev
    expect(canDrop(tree, "lead", "dev-1")).toBe(false);
    expect(canDrop(tree, "lead", "sub-dev")).toBe(false);
    expect(canDrop(tree, "root", "lead")).toBe(false);
    expect(canDrop(tree, "root", "sub-dev")).toBe(false);
  });

  it("allows dropping onto valid non-descendants", () => {
    // dev-1 can report to other-root or dev-2
    expect(canDrop(tree, "dev-1", "other-root")).toBe(true);
    expect(canDrop(tree, "dev-1", "dev-2")).toBe(true);
    // sub-dev can report to root or lead
    expect(canDrop(tree, "sub-dev", "root")).toBe(true);
    expect(canDrop(tree, "sub-dev", "lead")).toBe(true);
  });

  it("blocks if dragSlug or targetSlug does not exist", () => {
    expect(canDrop(tree, "non-existent", null)).toBe(false);
    expect(canDrop(tree, "dev-1", "non-existent")).toBe(false);
  });
});

describe("findNode", () => {
  it("finds node at root or deep in tree", () => {
    const agents: OrgAgent[] = [
      { slug: "lead", name: "Lead", reportsToSlug: null },
      { slug: "dev", name: "Dev", reportsToSlug: "lead" },
    ];
    const tree = buildOrgTree(agents);
    expect(findNode(tree, "lead")?.name).toBe("Lead");
    expect(findNode(tree, "dev")?.name).toBe("Dev");
    expect(findNode(tree, "missing")).toBeNull();
  });
});
