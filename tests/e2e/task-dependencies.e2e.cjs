/**
 * P3-03 — browser E2E for task dependencies (DAG):
 * create 2 tasks, B depends on A → B shows "Bị chặn", dispatch B is refused (error message),
 * add A depends on B → reports cycle error.
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

  const inCol = (page, status, n) => page.getByTestId(`col-${status}`).getByTestId(`task-${n}`);
  const moveVia = async (page, n, label) => {
    const card = page.getByTestId(`task-${n}`);
    await card.getByLabel("Chuyển sang").selectOption({ label });
    const done = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes(`/tasks/${n}/transitions`),
    );
    await card.getByRole("button", { name: "Chuyển", exact: true }).click();
    await done;
  };

  const createTask = async (page, title) => {
    const f = page.getByRole("form", { name: "Tạo task" });
    await f.getByLabel("Tiêu đề").fill(title);
    await f.getByRole("button", { name: "Tạo task" }).click();
  };

  const createWorker = async (page, slug, name, path, projectSlug) => {
    await page.goto(`${BASE}/workers`);
    const f = page.getByRole("form", { name: "Tạo worker" });
    await f.getByLabel("Mã (slug)").fill(slug);
    await f.getByLabel("Tên").fill(name);
    await f.getByLabel("Thư mục làm việc").fill(path);
    if (projectSlug) await f.getByLabel("Dự án").selectOption(projectSlug);
    await f.getByRole("button", { name: "Tạo worker" }).click();
    await page.getByTestId(`worker-${slug}`).waitFor();
  };

  try {
    const ctx = await contextFor(browser, process.env.MAINT_TOKEN);
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());

    await step("maintainer creates project, worker, tasks A and B", async () => {
      // 1. Create project
      await page.goto(`${BASE}/projects`);
      await page.getByLabel("Mã (slug)").fill("deps-e2e-proj");
      await page.getByLabel("Tên").fill("Deps E2E Project");
      await page.getByRole("button", { name: "Tạo dự án" }).click();
      await page.getByRole("link", { name: "deps-e2e-proj" }).first().waitFor();

      // 2. Create worker mock
      await createWorker(page, "mock-deps-worker", "Mock Deps Worker", "/srv/e2e/deps-worker", "deps-e2e-proj");

      // 3. Create task 1 (A) and task 2 (B)
      await page.goto(`${BASE}/projects/deps-e2e-proj/tasks`);
      await page.getByRole("heading", { name: "Task — Deps E2E Project" }).waitFor();

      await createTask(page, "Task A Prerequisite");
      await inCol(page, "BACKLOG", 1).waitFor();

      await createTask(page, "Task B Dependent");
      await inCol(page, "BACKLOG", 2).waitFor();

      // Move task B (2) to TODO so it has the dispatch form
      await moveVia(page, 2, "Cần làm");
      await inCol(page, "TODO", 2).waitFor();
    });

    await step("B depends on A → B displays 'Bị chặn' (blocked)", async () => {
      const cardB = inCol(page, "TODO", 2);

      // Open dependencies details
      const depsDetails = cardB.getByTestId("task-2-deps");
      await depsDetails.locator("summary").click();

      // Fill dependency form: depends on 1 (Task A)
      const depForm = cardB.getByRole("form", { name: "Thêm phụ thuộc cho task #2" });
      await depForm.getByLabel("Số task phụ thuộc").fill("1");

      const postDep = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/tasks/2/dependencies"),
      );
      await depForm.getByRole("button", { name: "Thêm phụ thuộc" }).click();
      await postDep;

      // Card B should now display "Bị chặn"
      const blockedLabel = cardB.getByTestId("task-2-blocked");
      await blockedLabel.waitFor();
      assert.match(await blockedLabel.textContent(), /Bị chặn/, "Task B does not show 'Bị chặn' label");
    });

    await step("dispatch B is refused with task_blocked error message", async () => {
      const cardB = inCol(page, "TODO", 2);

      // Submit dispatch form
      const dispatchForm = cardB.getByRole("form", { name: "Chạy mock task #2" });
      const dispatchPost = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/tasks/2/dispatch"),
      );
      await dispatchForm.getByRole("button", { name: "Chạy mock", exact: true }).click();
      // P3-09: dispatch now asks for confirmation in a dialog
      await page.locator("dialog[open]").getByRole("button", { name: "Xác nhận", exact: true }).click();
      const res = await dispatchPost;
      assert.equal(res.status(), 409, "Dispatch should be refused with 409");

      // Error message is displayed in dispatch form
      const errorMsg = dispatchForm.getByRole("alert");
      await errorMsg.waitFor();
      const text = await errorMsg.textContent();
      assert.match(text, /chặn|task_blocked/i, "Error message does not mention blocked status");

      // Stays on board page, does not navigate to run page
      assert.ok(page.url().includes("/projects/deps-e2e-proj/tasks"), "Should stay on board page");
    });

    await step("add A depends on B → cycle detected error reported", async () => {
      const cardA = inCol(page, "BACKLOG", 1);

      // Open dependencies details for task A
      const depsDetailsA = cardA.getByTestId("task-1-deps");
      await depsDetailsA.locator("summary").click();

      // Fill dependency form: depends on 2 (Task B)
      const depFormA = cardA.getByRole("form", { name: "Thêm phụ thuộc cho task #1" });
      await depFormA.getByLabel("Số task phụ thuộc").fill("2");

      const postCycle = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/tasks/1/dependencies"),
      );
      await depFormA.getByRole("button", { name: "Thêm phụ thuộc" }).click();
      const res = await postCycle;
      assert.equal(res.status(), 409, "Adding cycle dependency should return 409");

      // Error message is displayed in dependency form
      const cycleError = depFormA.getByRole("alert");
      await cycleError.waitFor();
      const text = await cycleError.textContent();
      assert.match(text, /vòng lặp|dependency_cycle/i, "Error message does not report cycle");
    });
  } finally {
    await browser.close();
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
