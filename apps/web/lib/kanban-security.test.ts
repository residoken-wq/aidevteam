import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Kanban security checks (P3-04 / CLAUDE.md §9)", () => {
  const boardPath = path.resolve(__dirname, "../app/projects/[slug]/tasks/board.tsx");
  const drawerPath = path.resolve(__dirname, "../app/projects/[slug]/tasks/task-drawer.tsx");

  it("does not use dangerouslySetInnerHTML in Board", () => {
    const code = fs.readFileSync(boardPath, "utf-8");
    expect(code).not.toContain("dangerouslySetInnerHTML");
  });

  it("does not use dangerouslySetInnerHTML in TaskDrawer", () => {
    const code = fs.readFileSync(drawerPath, "utf-8");
    expect(code).not.toContain("dangerouslySetInnerHTML");
  });

  it("does not use innerHTML or unescaped HTML insertion in task UI components", () => {
    const boardCode = fs.readFileSync(boardPath, "utf-8");
    const drawerCode = fs.readFileSync(drawerPath, "utf-8");
    expect(boardCode).not.toContain(".innerHTML");
    expect(drawerCode).not.toContain(".innerHTML");
  });

  it("ensures card titles in Board use button elements for accessibility", () => {
    const code = fs.readFileSync(boardPath, "utf-8");
    expect(code).toContain('data-testid={`task-${t.number}-title-btn`}');
    expect(code).toMatch(/<button[^>]*data-testid=\{`task-\$\{t\.number\}-title-btn`\}/);
  });

  it("ensures TaskDrawer defines role dialog and aria-modal", () => {
    const code = fs.readFileSync(drawerPath, "utf-8");
    expect(code).toContain('role="dialog"');
    expect(code).toContain('aria-modal="true"');
    expect(code).toContain('data-testid="task-drawer"');
    expect(code).toContain('data-testid="drawer-close-btn"');
  });
});
