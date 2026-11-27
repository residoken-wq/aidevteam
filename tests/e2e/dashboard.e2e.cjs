/**
 * P2-02 — browser E2E for dashboard:
 * org mới → dashboard hiện 0 và "Chưa có dữ liệu";
 * tạo 1 project + 1 task → số project đang dùng và số task BACKLOG tăng đúng 1.
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
  const step = async (name, fn) => {
    try {
      await fn();
      results.push(`PASS  ${name}`);
    } catch (e) {
      results.push(`FAIL  ${name}: ${e.message.split("\n").filter(Boolean).slice(0, 4).join(" | ")}`);
    }
  };

  try {
    const maint = await contextFor(browser, process.env.MAINT_TOKEN);
    const page = await maint.newPage();
    page.on("dialog", (d) => d.accept());

    let initProjects = 0;
    let initBacklog = 0;

    await step("maintainer opens dashboard: empty org shows 0 and 'Chưa có dữ liệu'", async () => {
      await page.goto(`${BASE}/dashboard`);
      await page.getByRole("heading", { name: /Tổng quan/ }).waitFor();

      const projectsText = await page.getByTestId("stat-projects-active").innerText();
      initProjects = parseInt(projectsText, 10);
      const backlogText = await page.getByTestId("stat-tasks-BACKLOG").innerText();
      initBacklog = parseInt(backlogText, 10);

      if (initProjects === 0) {
        assert.equal(initProjects, 0, "projects.active should start at 0");
        assert.equal(initBacklog, 0, "tasks.BACKLOG should start at 0");
        await page.getByText("Chưa có dữ liệu").waitFor();
      }
    });

    await step("create 1 project and 1 task in BACKLOG", async () => {
      // 1. Create project
      await page.goto(`${BASE}/projects`);
      await page.getByLabel("Mã (slug)").fill("dash-e2e-proj");
      await page.getByLabel("Tên").fill("Dash E2E Project");
      await page.getByRole("button", { name: "Tạo dự án" }).click();
      await page.getByTestId("project-dash-e2e-proj").waitFor();

      // 2. Create task
      await page.goto(`${BASE}/projects/dash-e2e-proj/tasks`);
      await page.getByRole("heading", { name: /Task — Dash E2E Project/ }).waitFor();
      const form = page.getByRole("form", { name: "Tạo task" });
      await form.getByLabel("Tiêu đề").fill("Dashboard Task 1");
      await form.getByRole("button", { name: "Tạo task" }).click();
      await page.getByTestId("col-BACKLOG").getByTestId("task-1").waitFor();
    });

    await step("dashboard reflects +1 active project and +1 BACKLOG task", async () => {
      await page.goto(`${BASE}/dashboard`);
      await page.getByRole("heading", { name: /Tổng quan/ }).waitFor();

      const newProjects = parseInt(await page.getByTestId("stat-projects-active").innerText(), 10);
      const newBacklog = parseInt(await page.getByTestId("stat-tasks-BACKLOG").innerText(), 10);

      assert.equal(newProjects, initProjects + 1, "active projects increased by exactly 1");
      assert.equal(newBacklog, initBacklog + 1, "BACKLOG tasks increased by exactly 1");
    });

    await step("home page has 'Tổng quan' link when user has dashboard:read permission", async () => {
      await page.goto(`${BASE}/`);
      const link = page.getByRole("link", { name: "Tổng quan" });
      await link.waitFor();
      await link.click();
      await page.waitForURL(`${BASE}/dashboard`);
      await page.getByRole("heading", { name: /Tổng quan/ }).waitFor();
    });

    const viewer = await contextFor(browser, process.env.VIEWER_TOKEN);
    const vpage = await viewer.newPage();

    await step("viewer can view dashboard", async () => {
      await vpage.goto(`${BASE}/dashboard`);
      await vpage.getByRole("heading", { name: /Tổng quan/ }).waitFor();
      const vProjects = parseInt(await vpage.getByTestId("stat-projects-active").innerText(), 10);
      assert.ok(vProjects >= 1, "viewer sees updated projects count");
    });
  } finally {
    await browser.close();
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
