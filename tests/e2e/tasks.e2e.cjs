/**
 * P3-02/P3-04 — browser E2E for the Kanban: create (HTML in text stays text) → drag BACKLOG→TODO → illegal drag refused →
 * walk to DONE with confirmation → cancel with a reason → a stale board gets 409 and reloads; viewer is read-only.
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
  // On failure, report the alert texts on the main page and the dialogs seen (no screenshots: they could carry session data).
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
  // Grab the card by its title line: since P4-07 the card centre can hold the "Chạy mock" form controls, which do not start a drag.
  const GRAB = { sourcePosition: { x: 8, y: 6 } };
  const moveVia = async (page, n, label) => {
    const card = page.getByTestId(`task-${n}`);
    await card.getByLabel("Chuyển sang").selectOption({ label });
    await card.getByRole("button", { name: "Chuyển" }).click();
  };
  const createTask = async (page, title, description) => {
    const f = page.getByRole("form", { name: "Tạo task" });
    await f.getByLabel("Tiêu đề").fill(title);
    if (description) await f.getByLabel("Mô tả").fill(description);
    await f.getByRole("button", { name: "Tạo task" }).click();
  };
  try {
    const ctx = await contextFor(browser, process.env.MAINT_TOKEN);
    const page = await ctx.newPage();
    diagPage = page;
    page.on("dialog", (d) => {
      dialogs.push(d.type());
      return d.type() === "prompt" ? d.accept("trùng với task khác") : d.accept();
    });
    const BOARD = `${BASE}/projects/kanban-e2e/tasks`;

    await step("create a project, open its board, create tasks; HTML in text is shown as text", async () => {
      await page.goto(`${BASE}/projects`);
      await page.getByLabel("Mã (slug)").fill("kanban-e2e");
      await page.getByLabel("Tên").fill("Kanban E2E");
      await page.getByRole("button", { name: "Tạo dự án" }).click();
      await page.getByRole("link", { name: "kanban-e2e" }).click();
      await page.getByRole("heading", { name: "Task — Kanban E2E" }).waitFor();
      await createTask(page, "<b>Task một</b>", XSS);
      await inCol(page, "BACKLOG", 1).waitFor();
      await createTask(page, "Task hai");
      await inCol(page, "BACKLOG", 2).waitFor(); // the form resets after each response; do not type into it while one is pending
      await createTask(page, "Task ba");
      await inCol(page, "BACKLOG", 3).waitFor();
      const card = page.getByTestId("task-1");
      await card.getByText("<b>Task một</b>").waitFor();
      await card.locator("summary").click();
      await card.getByText(XSS).waitFor();
      assert.equal(await card.locator("script, img, b").count(), 0, "HTML from task text was rendered");
      assert.equal(await page.evaluate(() => globalThis.__xss), undefined, "script from task text ran");
    });

    await step("drag a card BACKLOG → Cần làm", async () => {
      await page.getByTestId("task-1").dragTo(page.getByTestId("col-TODO"), GRAB);
      await inCol(page, "TODO", 1).waitFor();
      await page.reload();
      await inCol(page, "TODO", 1).waitFor();
    });

    await step("an illegal drag (Cần làm → Hoàn thành) is refused and the card stays", async () => {
      await page.getByTestId("task-1").dragTo(page.getByTestId("col-DONE"), GRAB);
      await page.getByRole("alert").filter({ hasText: "Không thể chuyển" }).waitFor();
      await inCol(page, "TODO", 1).waitFor();
    });

    await step("walk to Hoàn thành with the review confirmation", async () => {
      await moveVia(page, 1, "Đang làm");
      await inCol(page, "IN_PROGRESS", 1).waitFor();
      await moveVia(page, 1, "Đang review");
      await inCol(page, "IN_REVIEW", 1).waitFor();
      await moveVia(page, 1, "Hoàn thành");
      await inCol(page, "DONE", 1).waitFor();
      assert.equal(await page.getByTestId("task-1").getByRole("button", { name: "Chuyển" }).count(), 0, "a DONE card still offers moves");
    });

    await step("cancel with a reason", async () => {
      await moveVia(page, 2, "Đã hủy");
      await inCol(page, "CANCELLED", 2).filter({ hasText: "Lý do hủy: trùng với task khác" }).waitFor();
    });

    await step("a stale board gets a conflict, rolls back and reloads", async () => {
      const stale = await ctx.newPage();
      stale.on("dialog", (d) => d.accept());
      await stale.goto(BOARD);
      await inCol(stale, "BACKLOG", 3).waitFor();
      await moveVia(page, 3, "Cần làm");
      await inCol(page, "TODO", 3).waitFor();
      await moveVia(stale, 3, "Cần làm");
      await stale.getByRole("alert").filter({ hasText: "vừa được chuyển trạng thái" }).waitFor();
      await inCol(stale, "TODO", 3).waitFor();
    });

    const vpage = await (await contextFor(browser, process.env.VIEWER_TOKEN)).newPage();
    await step("viewer sees the board but cannot create or move", async () => {
      await vpage.goto(BOARD);
      await inCol(vpage, "DONE", 1).waitFor();
      assert.equal(await vpage.getByRole("form", { name: "Tạo task" }).count(), 0);
      assert.equal(await vpage.getByRole("button", { name: "Chuyển" }).count(), 0);
      assert.equal(await vpage.locator('[draggable="true"]').count(), 0);
    });
  } finally {
    await browser.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
