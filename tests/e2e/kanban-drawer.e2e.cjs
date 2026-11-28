/**
 * P3-04r — browser E2E for Kanban filters, task drawer, and scroll preservation:
 * - AC-1: Filter by priority, agent, title keyword (q); combined with epic/sprint; reload preserves filters; "Xóa lọc" clears all.
 * - AC-2: Task drawer opened via card title button (mouse and Enter key); shows all required details;
 *   HTML in title and description is rendered as plain text (no XSS); ?task=n in URL opens drawer directly; Esc closes and restores focus.
 * - AC-3: Scroll position preserved across status transition (<= 50px deviation) and restored on page reload with same URL.
 * Fake data only. See tests/e2e/README.md.
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.BASE_URL;
const XSS = '<script>window.__xss=1</script><b>Drawer Bold</b>';

async function contextFor(browser, token) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  await ctx.addCookies([
    {
      name: "__Host-cc_session",
      value: token,
      domain: new URL(BASE).hostname,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return ctx;
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  let diagPage = null;
  const dialogs = [];

  const step = async (name, fn) => {
    try {
      await fn();
      results.push(`PASS  ${name}`);
    } catch (e) {
      const alerts = diagPage ? await diagPage.getByRole("alert").allTextContents().catch(() => []) : [];
      const diag = `${alerts.length ? ` | alerts: ${alerts.join(" / ")}` : ""}${dialogs.length ? ` | dialogs: ${dialogs.join(" / ")}` : ""}`;
      results.push(`FAIL  ${name}: ${e.message.split("\n").filter(Boolean).slice(0, 4).join(" | ")}${diag}`);
    }
  };

  const inCol = (page, status, n) => page.getByTestId(`col-${status}`).getByTestId(`task-${n}`);

  const createTask = async (page, title, priority, agentSlug, description) => {
    const f = page.getByRole("form", { name: "Tạo task" });
    await f.getByLabel("Tiêu đề").fill(title);
    if (priority) await f.getByLabel("Ưu tiên").selectOption(priority);
    if (agentSlug) await f.getByLabel("Agent").selectOption(agentSlug);
    if (description) await f.getByLabel("Mô tả").fill(description);
    await f.getByRole("button", { name: "Tạo task" }).click();
  };

  try {
    const ctx = await contextFor(browser, process.env.MAINT_TOKEN);
    const page = await ctx.newPage();
    diagPage = page;
    page.on("dialog", (d) => {
      dialogs.push(d.type());
      return d.accept();
    });

    const PROJECT_SLUG = "kanban-drawer-e2e";
    const TASKS_URL = `${BASE}/projects/${PROJECT_SLUG}/tasks`;

    await step("create project and test agent for Kanban drawer tests", async () => {
      // 1. Create agent
      await page.goto(`${BASE}/agents`);
      const af = page.getByRole("form", { name: "Tạo agent" });
      await af.getByLabel("Mã (slug)").fill("agent-kd-lead");
      await af.getByLabel("Tên", { exact: true }).fill("Agent KD Lead");
      await af.getByRole("button", { name: "Tạo agent" }).click();
      await page.getByTestId("agent-agent-kd-lead").waitFor();

      // 2. Create project
      await page.goto(`${BASE}/projects`);
      await page.getByLabel("Mã (slug)").fill(PROJECT_SLUG);
      await page.getByLabel("Tên").fill("Kanban Drawer E2E");
      await page.getByRole("button", { name: "Tạo dự án" }).click();
      await page.goto(TASKS_URL);
      await page.getByRole("heading", { name: "Task — Kanban Drawer E2E" }).waitFor();
    });

    await step("create tasks with diverse priorities, agent assignment, and HTML text", async () => {
      // Task 1: high priority, assigned to agent-kd-lead, contains XSS string
      await createTask(page, "Alpha Backend Service", "high", "agent-kd-lead", XSS);
      await inCol(page, "BACKLOG", 1).waitFor();

      // Task 2: medium priority, unassigned
      await createTask(page, "Beta Frontend UI", "medium", "", "UI components implementation");
      await inCol(page, "BACKLOG", 2).waitFor();

      // Task 3: low priority, unassigned
      await createTask(page, "Gamma Documentation", "low", "", "Project docs");
      await inCol(page, "BACKLOG", 3).waitFor();

      // Verify all 3 tasks are visible initially
      await inCol(page, "BACKLOG", 1).waitFor();
      await inCol(page, "BACKLOG", 2).waitFor();
      await inCol(page, "BACKLOG", 3).waitFor();
    });

    await step("AC-1: filter by priority on client-side and preserve in query string", async () => {
      const f = page.getByRole("form", { name: "Bộ lọc task" });
      await f.getByLabel("Ưu tiên:").selectOption("high");
      await f.getByRole("button", { name: "Lọc" }).click();
      await page.waitForURL(/priority=high/);

      // Task 1 (high) shown, Task 2 & 3 hidden
      await inCol(page, "BACKLOG", 1).waitFor();
      assert.equal(await inCol(page, "BACKLOG", 2).count(), 0, "Task 2 should be filtered out");
      assert.equal(await inCol(page, "BACKLOG", 3).count(), 0, "Task 3 should be filtered out");
      assert.ok(page.url().includes("priority=high"), "URL must contain priority=high");
    });

    await step("AC-1: filter by agent unassigned", async () => {
      const f = page.getByRole("form", { name: "Bộ lọc task" });
      await f.getByLabel("Ưu tiên:").selectOption("");
      await f.getByLabel("Agent:").selectOption("unassigned");
      await f.getByRole("button", { name: "Lọc" }).click();
      await page.waitForURL(/agent=unassigned/);

      // Task 2 & 3 (unassigned) shown, Task 1 (assigned) hidden
      await inCol(page, "BACKLOG", 2).waitFor();
      await inCol(page, "BACKLOG", 3).waitFor();
      assert.equal(await inCol(page, "BACKLOG", 1).count(), 0, "Task 1 should be filtered out");
      assert.ok(page.url().includes("agent=unassigned"), "URL must contain agent=unassigned");
    });

    await step("AC-1: filter by title search keyword (q)", async () => {
      const f = page.getByRole("form", { name: "Bộ lọc task" });
      await f.getByLabel("Agent:").selectOption("");
      await f.getByLabel("Tìm:").fill("backend");
      await f.getByRole("button", { name: "Lọc" }).click();
      await page.waitForURL(/q=backend/);

      await inCol(page, "BACKLOG", 1).waitFor();
      assert.equal(await inCol(page, "BACKLOG", 2).count(), 0);
      assert.equal(await inCol(page, "BACKLOG", 3).count(), 0);
      assert.ok(page.url().includes("q=backend"), "URL must contain q=backend");
    });

    await step("AC-1: reload preserves active filters from query string", async () => {
      await page.reload();
      await inCol(page, "BACKLOG", 1).waitFor();
      assert.equal(await inCol(page, "BACKLOG", 2).count(), 0);
      assert.equal(await inCol(page, "BACKLOG", 3).count(), 0);
    });

    await step("AC-1: Xóa lọc link clears all filters and restores full board", async () => {
      await page.getByRole("link", { name: "Xóa lọc" }).click();
      await page.waitForURL((url) => !url.searchParams.has("q") && !url.searchParams.has("priority") && !url.searchParams.has("agent"));
      await inCol(page, "BACKLOG", 1).waitFor();
      await inCol(page, "BACKLOG", 2).waitFor();
      await inCol(page, "BACKLOG", 3).waitFor();
      assert.ok(!page.url().includes("q="), "Query q must be cleared");
      assert.ok(!page.url().includes("priority="), "Query priority must be cleared");
      assert.ok(!page.url().includes("agent="), "Query agent must be cleared");
    });

    await step("AC-2: open task drawer via card title button click, verify URL and content", async () => {
      // Click title button of Task 1
      await page.getByTestId("task-1-title-btn").click();
      const drawer = page.getByTestId("task-drawer");
      await drawer.waitFor();
      await page.waitForURL(/task=1/);
      assert.ok(page.url().includes("task=1"), "URL must have ?task=1");

      // Verify content
      await drawer.getByTestId("drawer-task-title").filter({ hasText: "#1 Alpha Backend Service" }).waitFor();
      await drawer.getByTestId("drawer-task-status").filter({ hasText: "Backlog" }).waitFor();
      await drawer.getByTestId("drawer-task-priority").filter({ hasText: "Cao" }).waitFor();
      await drawer.getByTestId("drawer-task-agent").filter({ hasText: "agent-kd-lead" }).waitFor();

      // Description contains XSS payload, must be rendered as text, not HTML
      const descEl = drawer.getByTestId("drawer-task-description");
      await descEl.waitFor();
      assert.equal(await descEl.locator("script, b").count(), 0, "HTML from task description was rendered");
      assert.equal(await page.evaluate(() => globalThis.__xss), undefined, "script from description ran");

      // Verify quick links
      await drawer.getByRole("link", { name: "Mở trang chi tiết" }).waitFor();
      await drawer.getByRole("link", { name: "Hợp đồng task" }).waitFor();
      await drawer.getByRole("link", { name: "Lịch sử chạy" }).waitFor();

      // 5 latest activities section
      await drawer.getByTestId("drawer-task-activity").waitFor();
    });

    await step("AC-2: close drawer via Esc key and verify focus returns to trigger button", async () => {
      await page.keyboard.press("Escape");
      await page.getByTestId("task-drawer").waitFor({ state: "hidden" });
      await page.waitForURL((url) => !url.searchParams.has("task"));
      assert.ok(!page.url().includes("task=1"), "URL must not contain task=1 after close");

      // Focus should be back on task-1 title button
      await page.waitForFunction(() => {
        return globalThis.document.activeElement?.getAttribute("data-testid") === "task-1-title-btn";
      });
      const isFocused = await page.evaluate(() => {
        return globalThis.document.activeElement?.getAttribute("data-testid") === "task-1-title-btn";
      });
      assert.ok(isFocused, "Focus must return to the card title button");
    });

    await step("AC-2: open drawer via keyboard (Enter on title button) and close with button", async () => {
      await page.getByTestId("task-2-title-btn").focus();
      await page.keyboard.press("Enter");
      const drawer = page.getByTestId("task-drawer");
      await drawer.waitFor();
      await page.waitForURL(/task=2/);
      assert.ok(page.url().includes("task=2"), "URL must have ?task=2");

      await drawer.getByTestId("drawer-close-btn").click();
      await drawer.waitFor({ state: "hidden" });
      await page.waitForURL((url) => !url.searchParams.has("task"));
      assert.ok(!page.url().includes("task=2"));
    });

    await step("AC-2: direct link with ?task=3 opens drawer on page load", async () => {
      await page.goto(`${TASKS_URL}?task=3`);
      const drawer = page.getByTestId("task-drawer");
      await drawer.waitFor();
      await drawer.getByTestId("drawer-task-title").filter({ hasText: "#3 Gamma Documentation" }).waitFor();

      await page.keyboard.press("Escape");
      await drawer.waitFor({ state: "hidden" });
      await page.waitForURL((url) => !url.searchParams.has("task"));
    });

    await step("AC-3: scroll preservation across status transition and page reload", async () => {
      // Create several tasks to enable vertical scrolling
      for (let i = 4; i <= 10; i++) {
        await createTask(page, `Scroll Test Task ${i}`, "medium", "", "Description");
        await inCol(page, "BACKLOG", i).waitFor();
      }

      // Scroll down to task 10 at the end of the list
      const card = page.getByTestId("task-10");
      await card.scrollIntoViewIfNeeded();
      const scrollBefore = await page.evaluate(() => globalThis.window.scrollY);

      // Move task 10 to TODO
      await card.getByLabel("Chuyển sang").selectOption({ label: "Cần làm" });
      const done = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/tasks/10/transitions"));
      await card.getByRole("button", { name: "Chuyển", exact: true }).click();
      await done;
      await inCol(page, "TODO", 10).waitFor();

      // Verify scroll position deviation <= 50px
      await page.waitForFunction(
        (target) => Math.abs(globalThis.window.scrollY - target) <= 50,
        scrollBefore,
      );
      const scrollAfterMove = await page.evaluate(() => globalThis.window.scrollY);
      assert.ok(
        Math.abs(scrollAfterMove - scrollBefore) <= 50,
        `Scroll after move (${scrollAfterMove}) deviated too much from before (${scrollBefore})`,
      );

      // Reload page with same URL and verify scroll restored
      await page.reload();
      await inCol(page, "TODO", 10).waitFor();
      await page.waitForFunction(
        (target) => Math.abs(globalThis.window.scrollY - target) <= 50,
        scrollBefore,
      );
      const scrollAfterReload = await page.evaluate(() => globalThis.window.scrollY);
      assert.ok(
        Math.abs(scrollAfterReload - scrollBefore) <= 50,
        `Scroll after reload (${scrollAfterReload}) deviated too much from before (${scrollBefore})`,
      );
    });
  } finally {
    await browser.close();
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
