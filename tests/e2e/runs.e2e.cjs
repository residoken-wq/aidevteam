/**
 * P4-07 / P4b — browser E2E for mock dispatch:
 * maintainer creates project + task → moves to TODO → creates mock worker → clicks "Chạy mock" →
 * navigates to run page showing QUEUED; viewer opens run page (no "Hủy" button) and task board
 * (no "Chạy mock" form); non-UUID or non-existent run ID returns 404.
 * Fake data only. See tests/e2e/README.md.
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.BASE_URL;
const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';

async function contextFor(browser, token) {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "__Host-cc_session", value: token, domain: new URL(BASE).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
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
    // Optimistic board: wait for the server to commit before dispatching (else task_not_dispatchable can race).
    const done = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/tasks/${n}/transitions`));
    await card.getByRole("button", { name: "Chuyển", exact: true }).click();
    await done;
  };
  const createTask = async (page, title, description) => {
    const f = page.getByRole("form", { name: "Tạo task" });
    await f.getByLabel("Tiêu đề").fill(title);
    if (description) await f.getByLabel("Mô tả").fill(description);
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

  try {
    const mctx = await contextFor(browser, process.env.MAINT_TOKEN);
    const mpage = await mctx.newPage();
    mpage.on("dialog", (d) => d.accept());

    await step("maintainer creates project, task, moves to TODO, creates mock worker", async () => {
      // 1. Create project
      await mpage.goto(`${BASE}/projects`);
      await mpage.getByLabel("Mã (slug)").fill("runs-e2e-proj");
      await mpage.getByLabel("Tên").fill("Runs E2E Project");
      await mpage.getByRole("button", { name: "Tạo dự án" }).click();
      await mpage.getByRole("link", { name: "runs-e2e-proj" }).first().waitFor();

      // 2. Create worker mock
      await createWorker(mpage, "mock-run-e2e", "Mock Run Worker", "/srv/e2e/mock-runs", "runs-e2e-proj");

      // 3. Create task and move to TODO
      await mpage.goto(`${BASE}/projects/runs-e2e-proj/tasks`);
      await mpage.getByRole("heading", { name: "Task — Runs E2E Project" }).waitFor();
      await createTask(mpage, "Task Chạy Mock", `Mô tả XSS ${XSS}`);
      await inCol(mpage, "BACKLOG", 1).waitFor();

      await moveVia(mpage, 1, "Cần làm");
      await inCol(mpage, "TODO", 1).waitFor();
    });

    await step("maintainer clicks Chạy mock from Kanban card → navigates to run page showing QUEUED (AC-9a, AC-9b)", async () => {
      const card = inCol(mpage, "TODO", 1);
      const dispatchButton = card.getByRole("button", { name: "Chạy mock", exact: true });
      await dispatchButton.waitFor();
      await dispatchButton.click();

      // P3-09: confirm dialog before dispatch
      const confirmDialog = mpage.locator("dialog[open]");
      if ((await confirmDialog.count()) > 0) {
        await confirmDialog.getByRole("button", { name: "Xác nhận" }).click();
      }

      await mpage.waitForURL(/\/runs\/[0-9a-f-]{36}/);
      runUrl = mpage.url();

      const statusEl = mpage.getByTestId("run-status");
      await statusEl.waitFor();
      assert.match(await statusEl.textContent(), /QUEUED/, "Run status is not QUEUED");

      // Maintainer sees "Hủy" button because status is QUEUED
      assert.equal(await mpage.getByRole("button", { name: "Hủy" }).count(), 1, "Maintainer should see Hủy button for QUEUED run");

      // AC-9b: ensure no active script or img tags rendered from task
      // Next.js injects its own <script> tags, so look only for the injected payload, not every script/img on the page.
      assert.equal(await mpage.locator('img[src="x"]').count(), 0, "HTML from task was rendered as an img tag");
      assert.equal(await mpage.evaluate(() => [...globalThis.document.scripts].some((s) => (s.textContent || "").includes("__xss"))), false, "HTML from task was rendered as a script tag");
      assert.equal(await mpage.evaluate(() => globalThis.__xss), undefined, "script from task ran");
    });

    const vctx = await contextFor(browser, process.env.VIEWER_TOKEN);
    const vpage = await vctx.newPage();
    vpage.on("dialog", (d) => d.accept());

    await step("viewer opens run page: sees QUEUED but no Hủy button (AC-9c)", async () => {
      assert.ok(runUrl, "runUrl should have been set by maintainer step");
      await vpage.goto(runUrl);
      const statusEl = vpage.getByTestId("run-status");
      await statusEl.waitFor();
      assert.match(await statusEl.textContent(), /QUEUED/);
      assert.equal(await vpage.getByRole("button", { name: "Hủy" }).count(), 0, "Viewer must not see Hủy button");
    });

    await step("viewer opens Kanban board: sees cards but no Chạy mock form/button (AC-9c)", async () => {
      await vpage.goto(`${BASE}/projects/runs-e2e-proj/tasks`);
      await inCol(vpage, "TODO", 1).waitFor();
      assert.equal(await vpage.getByRole("button", { name: "Chạy mock", exact: true }).count(), 0, "Viewer must not see Chạy mock button");
    });

    await step("invalid run id returns 404 (AC-9c)", async () => {
      const resNonUuid = await vpage.goto(`${BASE}/runs/not-a-uuid`);
      assert.equal(resNonUuid.status(), 404, "non-uuid id should return 404");

      const resNotFound = await vpage.goto(`${BASE}/runs/00000000-0000-0000-0000-000000000000`);
      assert.equal(resNotFound.status(), 404, "non-existent uuid should return 404");
    });
  } finally {
    await browser.close();
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
