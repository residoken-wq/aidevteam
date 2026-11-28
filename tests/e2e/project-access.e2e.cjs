/**
 * P2-13 AC-8 — browser E2E for project-scoped access:
 * org_admin creates two projects, assigns one (read) to a fake project_member user (900000006) in the UI ->
 * that user sees exactly that project, cannot open the other one, and gets a concise sidebar.
 * Env: BASE_URL, ADMIN_TOKEN, PM_TOKEN (fake sessions from run-local.sh). Fake data only.
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.BASE_URL;
const PM_ID = "900000006";

async function contextFor(browser, token) {
  assert.ok(token, "session token env var is missing");
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

  try {
    const admin = await contextFor(browser, process.env.ADMIN_TOKEN);
    const pm = await contextFor(browser, process.env.PM_TOKEN);
    const adminPage = await admin.newPage();
    const pmPage = await pm.newPage();

    await step("org_admin creates two fake projects via API", async () => {
      for (const [slug, name] of [
        ["pa-e2e-assigned", "PA E2E Assigned"],
        ["pa-e2e-other", "PA E2E Other"],
      ]) {
        const res = await admin.request.post(`${BASE}/api/projects`, {
          data: { slug, name },
          headers: { Origin: BASE }, // API requires Origin === PUBLIC_BASE_URL (CSRF guard)
        });
        assert.ok(res.ok() || res.status() === 409, `create ${slug}: ${res.status()} ${await res.text()}`);
      }
    });

    await step("org_admin assigns pa-e2e-assigned (read) to the project_member in the UI", async () => {
      await adminPage.goto(`${BASE}/projects/pa-e2e-assigned/members`);
      await adminPage.getByRole("heading", { level: 1 }).waitFor();
      await adminPage.getByLabel("GitHub ID").fill(PM_ID);
      await adminPage.getByLabel("Quyền truy cập").selectOption("read");
      await adminPage.getByRole("button", { name: "Giao dự án", exact: true }).click();
      await adminPage.getByTestId(`project-member-${PM_ID}`).waitFor();
    });

    await step("project_member sees exactly the assigned project in /projects", async () => {
      await pmPage.goto(`${BASE}/projects`);
      await pmPage.getByTestId("project-pa-e2e-assigned").waitFor();
      assert.equal(await pmPage.locator("table tbody tr").count(), 1);
      assert.equal(await pmPage.getByTestId("project-pa-e2e-other").count(), 0);
    });

    await step("project_member cannot read the unassigned project (API 404)", async () => {
      const res = await pm.request.get(`${BASE}/api/projects/pa-e2e-other`);
      assert.equal(res.status(), 404);
      const own = await pm.request.get(`${BASE}/api/projects/pa-e2e-assigned`);
      assert.equal(own.status(), 200);
    });

    await step("read assignment cannot create tasks (API 403)", async () => {
      const res = await pm.request.post(`${BASE}/api/projects/pa-e2e-assigned/tasks`, {
        data: { title: "PA E2E task" },
        headers: { Origin: BASE },
      });
      assert.equal(res.status(), 403);
    });

    await step("project_member sidebar has Dự án but no org-wide pages", async () => {
      const links = await pmPage.locator("nav a").allInnerTexts();
      assert.ok(links.some((l) => l.includes("Dự án")), `links: ${links.join(", ")}`);
      for (const hidden of ["Tổng quan", "Thành viên", "Tài khoản provider", "Duyệt release"]) {
        assert.ok(!links.some((l) => l.includes(hidden)), `unexpected link ${hidden}`);
      }
    });
  } finally {
    await browser.close();
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
