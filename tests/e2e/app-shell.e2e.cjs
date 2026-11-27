/**
 * P2-01 — browser E2E for app shell: header, sidebar, route guard.
 * (a) maintainer: thấy sidebar có Dự án/Agent/Worker…, KHÔNG có "Thành viên" (không có member:read), có nút Đăng xuất ở header, đúng 1 nút Đăng xuất trên trang;
 * (b) viewer: không thấy link "Thành viên", "Quản trị tổ chức";
 * (c) chưa đăng nhập (context không cookie) mở /projects → về /login, không thấy sidebar;
 * (d) viewport 375×800: không có cuộn ngang (document.documentElement.scrollWidth <= window.innerWidth), link Dự án vẫn tới được;
 * (e) trang /projects có link Dự án aria-current="page".
 * Fake data only. See tests/e2e/README.md.
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
    const maintCtx = await contextFor(browser, process.env.MAINT_TOKEN);
    const maintPage = await maintCtx.newPage();
    maintPage.on("dialog", (d) => d.accept());

    await step("maintainer sees sidebar with Dự án/Agent/Worker but NO Thành viên, and exactly 1 logout button in header", async () => {
      await maintPage.goto(`${BASE}/`);
      const navMain = maintPage.getByRole("navigation", { name: "Điều hướng chính" });
      await navMain.waitFor();

      await navMain.getByRole("link", { name: "Dự án" }).waitFor();
      await navMain.getByRole("link", { name: "Agent" }).waitFor();
      await navMain.getByRole("link", { name: "Worker" }).waitFor();
      await navMain.getByRole("link", { name: "Tài khoản provider" }).waitFor();

      assert.equal(await navMain.getByRole("link", { name: "Thành viên" }).count(), 0);
      assert.equal(await maintPage.getByRole("link", { name: "Thành viên" }).count(), 0);

      const logoutButtons = maintPage.getByRole("button", { name: "Đăng xuất" });
      assert.equal(await logoutButtons.count(), 1);
      const header = maintPage.locator("header");
      assert.equal(await header.getByRole("button", { name: "Đăng xuất" }).count(), 1);
    });

    const viewerCtx = await contextFor(browser, process.env.VIEWER_TOKEN);
    const viewerPage = await viewerCtx.newPage();
    viewerPage.on("dialog", (d) => d.accept());

    await step("viewer does not see Thành viên or Quản trị tổ chức", async () => {
      await viewerPage.goto(`${BASE}/`);
      await viewerPage.getByRole("navigation", { name: "Điều hướng chính" }).waitFor();

      assert.equal(await viewerPage.getByRole("link", { name: "Thành viên" }).count(), 0);
      assert.equal(await viewerPage.getByRole("link", { name: "Quản trị tổ chức" }).count(), 0);
    });

    const anonCtx = await browser.newContext();
    const anonPage = await anonCtx.newPage();

    await step("unauthenticated user opening /projects is redirected to /login with no sidebar", async () => {
      await anonPage.goto(`${BASE}/projects`);
      await anonPage.waitForURL(/\/login/);
      await anonPage.getByRole("heading", { name: /AI Dev Team Control Center/ }).waitFor();

      assert.equal(await anonPage.getByRole("navigation", { name: "Điều hướng chính" }).count(), 0);
      assert.equal(await anonPage.getByRole("button", { name: "Đăng xuất" }).count(), 0);
    });

    await step("viewport 375x800 has no horizontal scroll and Dự án link is accessible", async () => {
      await maintPage.setViewportSize({ width: 375, height: 800 });
      await maintPage.goto(`${BASE}/`);

      const noHorizontalScroll = await maintPage.evaluate(() => {
        return document.documentElement.scrollWidth <= window.innerWidth;
      });
      assert.ok(noHorizontalScroll, "page must not scroll horizontally on 375px viewport");

      const projectLink = maintPage.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Dự án" });
      await projectLink.waitFor();
      await projectLink.click();
      await maintPage.waitForURL(/\/projects/);
      await maintPage.getByRole("heading", { name: /Dự án/ }).waitFor();
    });

    await step("page /projects has Dự án link with aria-current='page'", async () => {
      await maintPage.goto(`${BASE}/projects`);
      await maintPage.getByRole("heading", { name: /Dự án/ }).waitFor();

      const navMain = maintPage.getByRole("navigation", { name: "Điều hướng chính" });
      const projectLink = navMain.getByRole("link", { name: "Dự án" });
      assert.equal(await projectLink.getAttribute("aria-current"), "page");

      const agentLink = navMain.getByRole("link", { name: "Agent" });
      assert.notEqual(await agentLink.getAttribute("aria-current"), "page");
    });
  } finally {
    await browser.close();
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
