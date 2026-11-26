/**
 * P2-03 — browser E2E for org management by a platform admin: create → rename → archive → restore;
 * a maintainer gets neither the link nor the page. Fake data only. See tests/e2e/README.md.
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.BASE_URL;

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
      results.push(`FAIL  ${name}: ${e.message.split("\n")[0]}`);
    }
  };
  try {
    const page = await (await contextFor(browser, process.env.PLATFORM_TOKEN)).newPage();
    page.on("dialog", (d) => d.accept());

    await step("platform admin finds the page from home and creates an org", async () => {
      await page.goto(`${BASE}/`);
      await page.getByRole("link", { name: "Quản trị tổ chức" }).click();
      await page.getByRole("heading", { name: "Quản trị tổ chức" }).waitFor();
      await page.getByLabel("Mã (slug)").fill("org-e2e");
      await page.getByLabel("Tên").fill("Org E2E");
      await page.getByRole("button", { name: "Tạo tổ chức" }).click();
      await page.getByTestId("org-org-e2e").filter({ hasText: "Đang hoạt động" }).waitFor();
    });

    await step("duplicate slug shows a readable error", async () => {
      await page.getByLabel("Mã (slug)").fill("org-e2e");
      await page.getByLabel("Tên").fill("Again");
      await page.getByRole("button", { name: "Tạo tổ chức" }).click();
      await page.getByRole("alert").filter({ hasText: "Mã tổ chức đã tồn tại" }).waitFor();
    });

    await step("rename the org", async () => {
      const row = page.getByTestId("org-org-e2e");
      await row.getByRole("button", { name: "Đổi tên" }).click();
      await row.locator('input[name="name"]').fill("Org E2E Renamed");
      await row.getByRole("button", { name: "Lưu" }).click();
      await page.getByTestId("org-org-e2e").filter({ hasText: "Org E2E Renamed" }).waitFor();
    });

    await step("archive then restore (with confirmation)", async () => {
      await page.getByTestId("org-org-e2e").getByRole("button", { name: "Lưu trữ" }).click();
      await page.getByTestId("org-org-e2e").waitFor({ state: "detached" });
      await page.goto(`${BASE}/platform/orgs?archived=true`);
      const row = page.getByTestId("org-org-e2e");
      await row.filter({ hasText: "Đã lưu trữ" }).waitFor();
      await row.getByRole("button", { name: "Khôi phục" }).click();
      await page.getByTestId("org-org-e2e").filter({ hasText: "Đang hoạt động" }).waitFor();
    });

    const mpage = await (await contextFor(browser, process.env.MAINT_TOKEN)).newPage();
    await step("maintainer sees no link and is refused on the page", async () => {
      await mpage.goto(`${BASE}/`);
      assert.equal(await mpage.getByRole("link", { name: "Quản trị tổ chức" }).count(), 0);
      await mpage.goto(`${BASE}/platform/orgs`);
      await mpage.getByRole("status").filter({ hasText: "Chỉ quản trị viên nền tảng" }).waitFor();
      assert.equal(await mpage.getByRole("button", { name: "Tạo tổ chức" }).count(), 0);
      assert.ok(!(await mpage.content()).includes("org-e2e"), "org list leaked to a maintainer");
    });
  } finally {
    await browser.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
