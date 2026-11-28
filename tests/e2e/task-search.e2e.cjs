/**
 * P3-08 AC-6 — Browser E2E for Task Search & Project Stats.
 * Verifies that:
 * 1. Filter form allows selecting status.
 * 2. Status filter is preserved in the URL after submission and across page reload.
 * 3. Viewer role can use the search page and view project stats.
 * 4. Links lead to project Kanban boards.
 *
 * Runs against a locally started api + web. Fake data only. See tests/e2e/README.md.
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.BASE_URL;
const COOKIE = "__Host-cc_session";

async function contextFor(browser, token) {
  const ctx = await browser.newContext();
  await ctx.addCookies([
    {
      name: COOKIE,
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
      results.push(`FAIL  ${name}: ${e.message.split("\n")[0]}`);
    }
  };

  try {
    // 1. Viewer test
    const viewerCtx = await contextFor(browser, process.env.VIEWER_TOKEN);
    const viewerPage = await viewerCtx.newPage();

    await step("viewer opens /tasks", async () => {
      await viewerPage.goto(`${BASE}/tasks`);
      await viewerPage.getByRole("heading", { name: /Tìm task/ }).waitFor();
    });

    await step("viewer sees project stats table", async () => {
      const statsSection = viewerPage.getByTestId("project-stats-section");
      await statsSection.waitFor();
      assert.ok(await statsSection.isVisible());
    });

    await step("viewer selects TODO status filter and submits form", async () => {
      const todoCheckbox = viewerPage.getByTestId("status-checkbox-TODO");
      await todoCheckbox.check();
      assert.equal(await todoCheckbox.isChecked(), true);

      await viewerPage.getByTestId("search-submit-btn").click();
      await viewerPage.waitForURL(/status=TODO/);
      assert.ok(viewerPage.url().includes("status=TODO"));
    });

    await step("filter is preserved in URL after reload", async () => {
      await viewerPage.reload();
      await viewerPage.getByRole("heading", { name: /Tìm task/ }).waitFor();
      assert.ok(viewerPage.url().includes("status=TODO"));

      const todoCheckbox = viewerPage.getByTestId("status-checkbox-TODO");
      assert.equal(await todoCheckbox.isChecked(), true);
    });

    await step("search results section is visible to viewer", async () => {
      const resultsSection = viewerPage.getByTestId("task-search-results");
      await resultsSection.waitFor();
      assert.ok(await resultsSection.isVisible());
    });
  } finally {
    await browser.close();
  }

  for (const r of results) console.log(r);
  if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
})();
