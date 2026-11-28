/**
 * P3-09 — browser E2E for run control:
 * - Dispatch with confirmation dialog (AC-3):
 *   - Clicking "Không" closes dialog and sends no request.
 *   - Pressing "Esc" closes dialog and sends no request.
 *   - Confirming dispatch creates run and navigates to /runs/:id.
 * - Cancel run with confirmation dialog (AC-3):
 *   - Clicking "Không" closes dialog, run remains QUEUED.
 *   - Confirming cancel transitions run to CANCELLED.
 * - 409 Conflict error message display (AC-4):
 *   - Blocked task dispatch fails with 409 and displays Vietnamese error message.
 * - Viewer permissions on /runs and direct cancel (AC-2):
 *   - Viewer sees /runs list but no dispatch or cancel buttons.
 *   - Viewer calling cancel API directly receives 403.
 *
 * Self-contained data creation. See tests/e2e/README.md.
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.BASE_URL;

async function contextFor(browser, token) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
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
    await card.getByRole("button", { name: "Chuyển" }).click();
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

  let runUrl = "";
  let runId = "";
  const projSlug = `rc-proj-${Date.now().toString(36)}`;
  const workerSlug = `rc-worker-${Date.now().toString(36)}`;

  try {
    const mctx = await contextFor(browser, process.env.MAINT_TOKEN);
    const page = await mctx.newPage();

    await step("maintainer creates project, worker, tasks 1 and 2, and sets up blocked dependency", async () => {
      // 1. Create project
      await page.goto(`${BASE}/projects`);
      await page.getByLabel("Mã (slug)").fill(projSlug);
      await page.getByLabel("Tên").fill("Run Control Project");
      await page.getByRole("button", { name: "Tạo dự án" }).click();
      await page.getByRole("link", { name: projSlug }).first().waitFor();

      // 2. Create mock worker
      await createWorker(page, workerSlug, "Mock Run Control Worker", `/srv/e2e/${workerSlug}`, projSlug);

      // 3. Create task 1 and task 2
      await page.goto(`${BASE}/projects/${projSlug}/tasks`);
      await page.getByRole("heading", { name: `Task — Run Control Project` }).waitFor();

      await createTask(page, "Task Prerequisite");
      await inCol(page, "BACKLOG", 1).waitFor();

      await createTask(page, "Task Blocked Dependent");
      await inCol(page, "BACKLOG", 2).waitFor();

      // Move task 1 and task 2 to TODO
      await moveVia(page, 1, "Cần làm");
      await inCol(page, "TODO", 1).waitFor();

      await moveVia(page, 2, "Cần làm");
      await inCol(page, "TODO", 2).waitFor();

      // Make task 2 depend on task 1 (so task 2 is blocked because task 1 is not DONE)
      const card2 = inCol(page, "TODO", 2);
      const depsDetails = card2.getByTestId("task-2-deps");
      await depsDetails.locator("summary").click();

      const depForm = card2.getByRole("form", { name: "Thêm phụ thuộc cho task #2" });
      await depForm.getByLabel("Số task phụ thuộc").fill("1");
      const postDep = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/tasks/2/dependencies"),
      );
      await depForm.getByRole("button", { name: "Thêm phụ thuộc" }).click();
      await postDep;

      const blockedLabel = card2.getByTestId("task-2-blocked");
      await blockedLabel.waitFor();
      assert.match(await blockedLabel.textContent(), /Bị chặn/);
    });

    await step("AC-3: clicking Không in dispatch dialog sends no request and closes dialog", async () => {
      const card1 = inCol(page, "TODO", 1);
      const dispatchButton = card1.getByRole("button", { name: "Chạy mock" });
      await dispatchButton.waitFor();
      await dispatchButton.click();

      // Dialog opens
      const dialog = page.locator("dialog[open]");
      await dialog.waitFor();
      assert.equal(await dialog.getAttribute("aria-modal"), "true", "Dialog must have aria-modal=true");

      let requestSent = false;
      const onRequest = (r) => {
        if (r.url().includes("/dispatch")) requestSent = true;
      };
      page.on("request", onRequest);

      // Click "Không"
      const cancelBtn = dialog.getByRole("button", { name: "Không" });
      await cancelBtn.click();

      // Dialog closed
      assert.equal(await page.locator("dialog[open]").count(), 0, "Dialog should be closed after clicking Không");
      assert.equal(requestSent, false, "No dispatch request should have been sent when clicking Không");
      page.off("request", onRequest);
    });

    await step("AC-3: pressing Esc in dispatch dialog sends no request and closes dialog", async () => {
      const card1 = inCol(page, "TODO", 1);
      const dispatchButton = card1.getByRole("button", { name: "Chạy mock" });
      await dispatchButton.waitFor();
      await dispatchButton.click();

      const dialog = page.locator("dialog[open]");
      await dialog.waitFor();

      let requestSent = false;
      const onRequest = (r) => {
        if (r.url().includes("/dispatch")) requestSent = true;
      };
      page.on("request", onRequest);

      // Press Escape key
      await page.keyboard.press("Escape");

      assert.equal(await page.locator("dialog[open]").count(), 0, "Dialog should be closed after pressing Escape");
      assert.equal(requestSent, false, "No dispatch request should have been sent when pressing Escape");
      page.off("request", onRequest);
    });

    await step("AC-3: confirming dispatch creates run and navigates to /runs/:id", async () => {
      const card1 = inCol(page, "TODO", 1);
      const dispatchButton = card1.getByRole("button", { name: "Chạy mock" });
      await dispatchButton.click();

      const dialog = page.locator("dialog[open]");
      await dialog.waitFor();

      const confirmBtn = dialog.getByRole("button", { name: "Xác nhận" });
      await confirmBtn.click();

      await page.waitForURL(/\/runs\/[0-9a-f-]{36}/);
      runUrl = page.url();
      runId = runUrl.split("/").pop();

      const statusEl = page.getByTestId("run-status");
      await statusEl.waitFor();
      assert.match(await statusEl.textContent(), /QUEUED/);
    });

    await step("AC-3: cancel run dialog - clicking Không keeps run QUEUED, confirming cancels run", async () => {
      // 1. Click Hủy
      const cancelBtn = page.getByRole("button", { name: "Hủy" });
      await cancelBtn.waitFor();
      await cancelBtn.click();

      const dialog = page.locator("dialog[open]");
      await dialog.waitFor();

      // Click "Không" -> status remains QUEUED
      await dialog.getByRole("button", { name: "Không" }).click();
      assert.equal(await page.locator("dialog[open]").count(), 0);
      // The mock worker may already have picked the run up; either way it must not be cancelled.
      assert.match(await page.getByTestId("run-status").textContent(), /QUEUED|RUNNING/);

      // 2. Click Hủy again and confirm
      await cancelBtn.click();
      await dialog.waitFor();

      const postCancel = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes(`/runs/${runId}/cancel`),
      );
      await dialog.getByRole("button", { name: "Xác nhận hủy" }).click();
      await postCancel;

      // Run status transitions to CANCELLED
      // The page refreshes after the POST: wait for the new status instead of reading it immediately.
      await page.getByTestId("run-status").filter({ hasText: "CANCELLED" }).waitFor();
    });

    await step("AC-4: 409 Conflict displays clear Vietnamese error message on blocked task dispatch", async () => {
      await page.goto(`${BASE}/projects/${projSlug}/tasks`);
      await page.getByRole("heading", { name: `Task — Run Control Project` }).waitFor();

      const card2 = inCol(page, "TODO", 2);
      const dispatchBtn = card2.getByRole("button", { name: "Chạy mock" });
      await dispatchBtn.waitFor();
      await dispatchBtn.click();

      const dialog = page.locator("dialog[open]");
      await dialog.waitFor();

      const postDispatch = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/dispatch"),
      );
      await dialog.getByRole("button", { name: "Xác nhận" }).click();
      const response = await postDispatch;
      assert.equal(response.status(), 409, "Expected 409 Conflict for blocked task dispatch");

      // Verify Vietnamese error message appears on the card alert
      const alert = card2.getByRole("alert");
      await alert.waitFor();
      assert.match(
        await alert.textContent(),
        /Task đang bị chặn bởi các task phụ thuộc chưa hoàn thành/,
        "Did not display expected Vietnamese error message for task_blocked",
      );
    });

    await step("AC-2: maintainer sees /runs page with table and cancel button", async () => {
      await page.goto(`${BASE}/runs`);
      await page.getByRole("heading", { name: "Lượt chạy" }).waitFor();

      // Table should be visible with run row
      const runRow = page.getByTestId(`run-row-${runId}`);
      await runRow.waitFor();
      assert.equal(await runRow.count(), 1);
    });

    const vctx = await contextFor(browser, process.env.VIEWER_TOKEN);
    const vpage = await vctx.newPage();

    await step("AC-2: viewer sees /runs page but NO dispatch or cancel buttons; direct cancel API returns 403", async () => {
      await vpage.goto(`${BASE}/runs`);
      await vpage.getByRole("heading", { name: "Lượt chạy" }).waitFor();

      // Viewer sees table
      const runRow = vpage.getByTestId(`run-row-${runId}`);
      await runRow.waitFor();
      assert.equal(await runRow.count(), 1);

      // Viewer must NOT see any "Hủy" button on /runs
      assert.equal(
        await vpage.getByRole("button", { name: "Hủy" }).count(),
        0,
        "Viewer must not see Hủy button on /runs page",
      );

      // Viewer on Kanban board must NOT see "Chạy mock" button
      await vpage.goto(`${BASE}/projects/${projSlug}/tasks`);
      await inCol(vpage, "TODO", 1).waitFor();
      assert.equal(
        await vpage.getByRole("button", { name: "Chạy mock" }).count(),
        0,
        "Viewer must not see Chạy mock button on Kanban board",
      );

      // Direct POST /api/runs/:id/cancel returns 403 Forbidden
      const res = await vpage.evaluate(async (id) => {
        const r = await fetch(`/api/runs/${id}/cancel`, { method: "POST" });
        return r.status;
      }, runId);
      assert.equal(res, 403, "Viewer direct cancel call must return 403");
    });
  } finally {
    await browser.close();
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
