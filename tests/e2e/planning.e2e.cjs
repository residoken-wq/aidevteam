/**
 * P3-01 — browser E2E for planning (epics, milestones, sprints):
 * Maintainer opens planning page, creates epic and sprint, starts sprint, creates task attached to
 * epic and sprint, filters Kanban by sprint; viewer opens planning page and sees tables without create forms.
 * Fake data only. See tests/e2e/README.md.
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.BASE_URL;

async function contextFor(browser, token) {
  const ctx = await browser.newContext();
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

  try {
    const ctx = await contextFor(browser, process.env.MAINT_TOKEN);
    const page = await ctx.newPage();
    diagPage = page;
    page.on("dialog", (d) => {
      dialogs.push(d.type());
      return d.accept();
    });

    const PROJECT_SLUG = "planning-e2e";
    const PLANNING_URL = `${BASE}/projects/${PROJECT_SLUG}/planning`;
    const TASKS_URL = `${BASE}/projects/${PROJECT_SLUG}/tasks`;

    await step("create a project and open planning page", async () => {
      await page.goto(`${BASE}/projects`);
      await page.getByLabel("Mã (slug)").fill(PROJECT_SLUG);
      await page.getByLabel("Tên").fill("Planning E2E");
      await page.getByRole("button", { name: "Tạo dự án" }).click();
      await page.goto(PLANNING_URL);
      await page.getByRole("heading", { name: /Kế hoạch/ }).waitFor();
    });

    await step("create epic and sprint on planning page", async () => {
      const epicForm = page.getByRole("form", { name: "Tạo epic" });
      await epicForm.getByLabel("Mã epic (slug)").fill("core-feature");
      await epicForm.getByLabel("Tiêu đề").fill("Core Feature");
      await epicForm.getByRole("button", { name: "Tạo epic" }).click();
      await page.getByTestId("epic-row-core-feature").waitFor();

      const sprintForm = page.getByRole("form", { name: "Tạo sprint" });
      await sprintForm.getByLabel("Tên sprint").fill("Sprint 1");
      await sprintForm.getByLabel("Ngày bắt đầu").fill("2026-12-01");
      await sprintForm.getByLabel("Ngày kết thúc").fill("2026-12-14");
      await sprintForm.getByRole("button", { name: "Tạo sprint" }).click();
      await page.getByTestId("sprint-row-1").waitFor();
    });

    await step("start sprint", async () => {
      const startBtn = page.getByTestId("start-sprint-1");
      await startBtn.click();
      await page.getByTestId("close-sprint-1").waitFor();
    });

    await step("create task attached to epic and sprint in Kanban and filter by sprint", async () => {
      await page.goto(TASKS_URL);
      await page.getByRole("heading", { name: /Task/ }).waitFor();

      const taskForm = page.getByRole("form", { name: "Tạo task" });
      await taskForm.getByLabel("Tiêu đề").fill("Task Planning E2E");
      await taskForm.getByLabel("Epic").selectOption({ value: "core-feature" });
      await taskForm.getByLabel("Sprint").selectOption({ value: "1" });
      await taskForm.getByRole("button", { name: "Tạo task" }).click();

      const taskCard = page.getByTestId("task-1");
      await taskCard.waitFor();
      await page.getByTestId("badge-epic-1").waitFor();
      await page.getByTestId("badge-sprint-1").waitFor();

      // Filter by sprint 1
      const filterForm = page.getByRole("form", { name: "Bộ lọc task" });
      await filterForm.getByLabel("Sprint:").selectOption({ value: "1" });
      await filterForm.getByRole("button", { name: "Lọc" }).click();

      await page.getByTestId("task-1").waitFor();
      assert.equal(await page.getByTestId("task-1").count(), 1, "task 1 found under sprint filter");
    });

    const vpage = await (await contextFor(browser, process.env.VIEWER_TOKEN)).newPage();
    await step("viewer sees planning tables but cannot create or transition", async () => {
      await vpage.goto(PLANNING_URL);
      await vpage.getByRole("heading", { name: /Kế hoạch/ }).waitFor();
      await vpage.getByTestId("epic-row-core-feature").waitFor();
      await vpage.getByTestId("sprint-row-1").waitFor();

      assert.equal(await vpage.getByRole("form", { name: "Tạo epic" }).count(), 0);
      assert.equal(await vpage.getByRole("form", { name: "Tạo sprint" }).count(), 0);
      assert.equal(await vpage.getByRole("form", { name: "Tạo milestone" }).count(), 0);
      assert.equal(await vpage.getByRole("button", { name: "Bắt đầu sprint" }).count(), 0);
      assert.equal(await vpage.getByRole("button", { name: "Đóng sprint" }).count(), 0);
      assert.equal(await vpage.getByRole("button", { name: "Lưu trữ" }).count(), 0);
    });
  } finally {
    await browser.close();
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
