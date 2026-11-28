/**
 * P3-05 — browser E2E for agent assignment (capabilities & capacity):
 * agent max 1 → assign task 1 OK, assign task 2 reports capacity limit (quá tải);
 * task requires capability agent lacks → reports capability mismatch (thiếu năng lực);
 * viewer is read-only. Fake data only. See tests/e2e/README.md.
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
      results.push(`FAIL  ${name}: ${e.message.split("\n")[0]}`);
    }
  };

  try {
    const page = await (await contextFor(browser, process.env.MAINT_TOKEN)).newPage();
    page.on("dialog", (d) => d.accept());

    await step("maintainer creates agent with max 1 active task and specific capabilities", async () => {
      await page.goto(`${BASE}/agents`);
      const f = page.getByRole("form", { name: "Tạo agent" });
      await f.getByLabel("Mã (slug)").fill("agent-e2e-solo");
      await f.getByLabel("Tên", { exact: true }).fill("Agent E2E Solo");
      await f.getByLabel("Năng lực (cách nhau bởi dấu phẩy)").fill("backend, nodejs");
      await f.getByLabel("Số việc tối đa").fill("1");
      await f.getByRole("button", { name: "Tạo agent" }).click();

      const row = page.getByTestId("agent-agent-e2e-solo");
      await row.waitFor();
      await row.filter({ hasText: "Đang làm 0 / 1" }).waitFor();
      await row.filter({ hasText: "backend, nodejs" }).waitFor();
    });

    await step("maintainer creates project for task assignment tests", async () => {
      await page.goto(`${BASE}/projects`);
      await page.getByLabel("Mã (slug)").fill("assign-e2e-proj");
      await page.getByLabel("Tên").fill("Assign E2E Project");
      await page.getByRole("button", { name: "Tạo dự án" }).click();
      await page.getByRole("link", { name: "assign-e2e-proj" }).first().waitFor();
    });

    await step("task requiring capabilities the agent lacks is rejected with mismatch error", async () => {
      await page.goto(`${BASE}/projects/assign-e2e-proj/tasks`);
      const f = page.getByRole("form", { name: "Tạo task" });
      await f.getByLabel("Tiêu đề").fill("React Task");
      await f.locator('select[name="agentSlug"]').selectOption("agent-e2e-solo");
      await f.getByLabel("Năng lực yêu cầu (cách nhau bởi dấu phẩy)").fill("react, frontend");
      await f.getByRole("button", { name: "Tạo task" }).click();

      // Error message should mention missing capability / năng lực
      await page.getByRole("alert").filter({ hasText: "năng lực" }).waitFor();
    });

    await step("task requiring matching capabilities is assigned and moved to active work", async () => {
      await page.goto(`${BASE}/projects/assign-e2e-proj/tasks`);
      const f = page.getByRole("form", { name: "Tạo task" });
      await f.getByLabel("Tiêu đề").fill("Backend Task 1");
      await f.locator('select[name="agentSlug"]').selectOption("agent-e2e-solo");
      await f.getByLabel("Năng lực yêu cầu (cách nhau bởi dấu phẩy)").fill("backend");
      await f.getByRole("button", { name: "Tạo task" }).click();

      // Task 1 card appears
      await page.getByTestId("task-1").filter({ hasText: "Backend Task 1" }).waitFor();

      // Move Task 1 to TODO (taking the single active slot)
      const card = page.getByTestId("task-1");
      await card.getByLabel("Chuyển sang").selectOption({ label: "Cần làm" });
      const done = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/tasks/1/transitions"),
      );
      await card.getByRole("button", { name: "Chuyển" }).click();
      await done;

      // Check agent table shows "Đang làm 1 / 1"
      await page.goto(`${BASE}/agents`);
      const row = page.getByTestId("agent-agent-e2e-solo");
      await row.filter({ hasText: "Đang làm 1 / 1" }).waitFor();
    });

    await step("assigning a second task to the agent is rejected due to capacity limit", async () => {
      await page.goto(`${BASE}/projects/assign-e2e-proj/tasks`);
      const f = page.getByRole("form", { name: "Tạo task" });
      await f.getByLabel("Tiêu đề").fill("Backend Task 2");
      await f.locator('select[name="agentSlug"]').selectOption("agent-e2e-solo");
      await f.getByLabel("Năng lực yêu cầu (cách nhau bởi dấu phẩy)").fill("backend");
      await f.getByRole("button", { name: "Tạo task" }).click();

      // Error message should indicate agent is at capacity
      await page.getByRole("alert").filter({ hasText: "tối đa" }).waitFor();
    });

    const vpage = await (await contextFor(browser, process.env.VIEWER_TOKEN)).newPage();
    await step("viewer cannot create agents or assign tasks", async () => {
      await vpage.goto(`${BASE}/agents`);
      await vpage.getByTestId("agent-agent-e2e-solo").waitFor();
      assert.equal(await vpage.getByRole("button", { name: "Tạo agent" }).count(), 0);

      await vpage.goto(`${BASE}/projects/assign-e2e-proj/tasks`);
      assert.equal(await vpage.getByRole("button", { name: "Tạo task" }).count(), 0);
    });
  } finally {
    await browser.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
