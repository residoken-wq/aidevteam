/**
 * P2-10 AC-8 — browser E2E for projects: create → rename → archive, plus viewer and XSS checks.
 * Runs against a locally started api + web (see docs in tests/e2e/README.md). Fake data only.
 *
 * Env: BASE_URL (web, e.g. http://localhost:3910), MAINT_TOKEN and VIEWER_TOKEN (raw session tokens for
 * seeded fake users; created by the runner script — never real sessions).
 * Requires the `playwright` package (preinstalled in the Claude Code cloud image; not a repo dependency yet).
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.BASE_URL;
const COOKIE = "__Host-cc_session";

async function contextFor(browser, token) {
  const ctx = await browser.newContext();
  // Chromium (CDP) rejects a __Host- cookie given with `url` on http://localhost; domain + path is accepted
  // and the cookie is still sent to http://localhost (a potentially trustworthy origin).
  await ctx.addCookies([{ name: COOKIE, value: token, domain: new URL(BASE).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
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
    const maint = await contextFor(browser, process.env.MAINT_TOKEN);
    const page = await maint.newPage();
    const dialogs = [];
    page.on("dialog", async (d) => {
      dialogs.push(d.message());
      await d.accept();
    });

    await step("maintainer opens /projects", async () => {
      await page.goto(`${BASE}/projects`);
      await page.getByRole("heading", { name: /Dự án/ }).waitFor();
    });

    await step("create a project through the form", async () => {
      await page.getByLabel("Mã (slug)").fill("e2e-project");
      await page.getByLabel("Tên").fill("E2E Project");
      await page.getByLabel("Mô tả").fill("tạo bằng Playwright");
      await page.getByRole("button", { name: "Tạo dự án" }).click();
      await page.getByTestId("project-e2e-project").waitFor();
      assert.match(await page.getByTestId("project-e2e-project").innerText(), /E2E Project/);
    });

    await step("duplicate slug shows a readable error", async () => {
      await page.getByLabel("Mã (slug)").fill("e2e-project");
      await page.getByLabel("Tên").fill("Another");
      await page.getByRole("button", { name: "Tạo dự án" }).click();
      await page.getByRole("alert").filter({ hasText: "đã tồn tại" }).waitFor();
    });

    await step("rename the project", async () => {
      const row = page.getByTestId("project-e2e-project");
      await row.getByRole("button", { name: "Đổi tên" }).click();
      await row.locator('input[name="name"]').fill("E2E Project Renamed");
      await row.getByRole("button", { name: "Lưu" }).click();
      await page.getByTestId("project-e2e-project").filter({ hasText: "E2E Project Renamed" }).waitFor();
    });

    await step("HTML in a project name is shown as text, not executed", async () => {
      let alerted = false;
      page.on("dialog", (d) => {
        if (d.type() === "alert") alerted = true;
      });
      await page.getByLabel("Mã (slug)").fill("xss-check");
      await page.getByLabel("Tên").fill('<img src=x onerror="alert(1)">');
      await page.getByRole("button", { name: "Tạo dự án" }).click();
      await page.getByTestId("project-xss-check").waitFor();
      assert.equal(await page.getByTestId("project-xss-check").locator("img").count(), 0);
      assert.match(await page.getByTestId("project-xss-check").innerText(), /<img src=x/);
      assert.equal(alerted, false);
    });

    await step("archive the project (with confirmation)", async () => {
      await page.getByTestId("project-e2e-project").getByRole("button", { name: "Lưu trữ" }).click();
      await page.getByTestId("project-e2e-project").waitFor({ state: "detached" });
      assert.ok(dialogs.some((m) => m.includes("E2E Project Renamed")));
      await page.getByRole("link", { name: "Hiện cả dự án đã lưu trữ" }).click();
      await page.getByTestId("project-e2e-project").filter({ hasText: "Đã lưu trữ" }).waitFor();
    });

    const viewer = await contextFor(browser, process.env.VIEWER_TOKEN);
    const vpage = await viewer.newPage();
    await step("viewer sees projects but no create form or action buttons", async () => {
      await vpage.goto(`${BASE}/projects`);
      await vpage.getByTestId("project-xss-check").waitFor();
      assert.equal(await vpage.getByRole("button", { name: "Tạo dự án" }).count(), 0);
      assert.equal(await vpage.getByRole("button", { name: "Lưu trữ" }).count(), 0);
    });

    await step("viewer calling the API directly is still refused (403)", async () => {
      const status = await vpage.evaluate(async () => {
        const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: "by-viewer", name: "By Viewer" }) });
        return r.status;
      });
      assert.equal(status, 403);
    });
  } finally {
    await browser.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
