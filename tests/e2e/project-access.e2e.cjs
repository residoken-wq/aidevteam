/**
 * P2-13 AC-8 — Browser E2E for project-scoped access:
 * org_admin assigns a project to a project_member user -> project_member sees only that 1 project.
 *
 * Env: BASE_URL, ADMIN_TOKEN, PM_TOKEN (fake session tokens).
 * Note: E2E runner does not run on Windows environment (see AGENT_PROTOCOL.md §3).
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
    const admin = await contextFor(browser, process.env.ADMIN_TOKEN);
    const pm = await contextFor(browser, process.env.PM_TOKEN);

    const adminPage = await admin.newPage();
    const pmPage = await pm.newPage();

    await step("admin visits project members page", async () => {
      await adminPage.goto(`${BASE}/projects/e2e-proj/members`);
      await adminPage.getByRole("heading", { name: /Dự án/ }).waitFor();
    });

    await step("admin assigns project to project_member", async () => {
      await adminPage.getByLabel("GitHub ID").fill("900000005");
      await adminPage.getByLabel("Quyền truy cập").selectOption("read");
      await adminPage.getByRole("button", { name: "Giao dự án" }).click();
      await adminPage.getByTestId("project-member-900000005").waitFor();
    });

    await step("project_member opens /projects and sees exactly 1 assigned project", async () => {
      await pmPage.goto(`${BASE}/projects`);
      await pmPage.getByRole("heading", { name: /Dự án/ }).waitFor();
      const rows = pmPage.locator("table tbody tr");
      await rows.first().waitFor();
      const count = await rows.count();
      assert.equal(count, 1);
      assert.match(await rows.first().innerText(), /e2e-proj/);
    });

    await step("project_member sees concise sidebar without org-wide pages", async () => {
      const links = await pmPage.locator("nav a").allInnerTexts();
      assert.ok(links.some((l) => l.includes("Dự án")));
      assert.ok(!links.some((l) => l.includes("Tổng quan")));
      assert.ok(!links.some((l) => l.includes("Thành viên")));
    });
  } finally {
    await browser.close();
    console.log(results.join("\n"));
  }
})();
