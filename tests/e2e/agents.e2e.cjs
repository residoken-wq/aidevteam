/**
 * P2-05 — browser E2E for agents (org chart): create with provider account and manager → reporting cycle refused →
 * archiving a manager with reports refused → detach and archive; viewer is read-only. Fake data only.
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
  const form = (page) => page.getByRole("form", { name: "Tạo agent" });
  const create = async (page, slug, extra = {}) => {
    const f = form(page);
    await f.getByLabel("Mã (slug)").fill(slug);
    await f.getByLabel("Tên", { exact: true }).fill(`Agent ${slug}`);
    if (extra.title) await f.getByLabel("Chức danh").fill(extra.title);
    if (extra.model) await f.getByLabel("Model").fill(extra.model);
    if (extra.pa) await f.locator('select[name="providerAccountSlug"]').selectOption(extra.pa);
    if (extra.mgr) await f.locator('select[name="reportsToSlug"]').selectOption(extra.mgr);
    await f.getByRole("button", { name: "Tạo agent" }).click();
  };
  try {
    const page = await (await contextFor(browser, process.env.MAINT_TOKEN)).newPage();
    page.on("dialog", (d) => d.accept());

    await step("maintainer builds a small org chart", async () => {
      await page.goto(`${BASE}/provider-accounts`);
      await page.getByLabel("Mã (slug)").fill("agent-e2e-pa");
      await page.getByLabel("Tên").fill("Agent E2E PA");
      await page.getByLabel("Tham chiếu secret").fill("env:AIDEV_SECRET_AGENT_E2E_PA");
      await page.getByRole("button", { name: "Tạo tài khoản" }).click();
      await page.getByTestId("pa-agent-e2e-pa").waitFor();
      if (process.env.ADMIN_TOKEN) {
        const apage = await (await contextFor(browser, process.env.ADMIN_TOKEN)).newPage();
        await apage.goto(`${BASE}/provider-accounts`);
        const row = apage.getByTestId("pa-agent-e2e-pa");
        await row.locator('select[name="licenseStatus"]').selectOption("approved");
        await row.getByRole("button", { name: "Đổi" }).click();
        await row.filter({ hasText: "Đã duyệt" }).waitFor();
        await apage.close();
      }
      await page.goto(`${BASE}/agents`);
      await create(page, "lead-e2e", { title: "Tech Lead", model: "claude-sonnet-x.y", pa: "agent-e2e-pa" });
      await page.getByTestId("agent-lead-e2e").filter({ hasText: "agent-e2e-pa" }).filter({ hasText: "Tech Lead" }).waitFor();
      await create(page, "dev-e2e", { mgr: "lead-e2e" });
      await page.getByTestId("agent-dev-e2e").filter({ hasText: "lead-e2e" }).waitFor();
    });

    await step("a reporting cycle is refused with an explanation", async () => {
      const row = page.getByTestId("agent-lead-e2e");
      await row.locator('select[name="reportsToSlug"]').selectOption("dev-e2e");
      await row.getByRole("button", { name: "Lưu cấp trên" }).click();
      await row.getByRole("alert").filter({ hasText: "vòng lặp" }).waitFor();
    });

    await step("a manager with reports cannot be archived", async () => {
      const row = page.getByTestId("agent-lead-e2e");
      await row.getByRole("button", { name: "Lưu trữ" }).click();
      await row.getByRole("alert").filter({ hasText: "còn cấp dưới" }).waitFor();
    });

    await step("detach the report, then archive the manager", async () => {
      await page.reload();
      const dev = page.getByTestId("agent-dev-e2e");
      await dev.locator('select[name="reportsToSlug"]').selectOption("");
      await dev.getByRole("button", { name: "Lưu cấp trên" }).click();
      await page.getByTestId("agent-dev-e2e").locator("td").nth(5).filter({ hasText: "—" }).waitFor();
      await page.getByTestId("agent-lead-e2e").getByRole("button", { name: "Lưu trữ" }).click();
      await page.getByTestId("agent-lead-e2e").waitFor({ state: "detached" });
    });

    const vpage = await (await contextFor(browser, process.env.VIEWER_TOKEN)).newPage();
    await step("viewer sees agents but cannot create or change them", async () => {
      await vpage.goto(`${BASE}/agents?archived=true`);
      await vpage.getByTestId("agent-lead-e2e").waitFor();
      assert.equal(await vpage.getByRole("button", { name: "Tạo agent" }).count(), 0);
      assert.equal(await vpage.getByRole("button", { name: "Lưu cấp trên" }).count(), 0);
      assert.ok(!(await vpage.content()).includes("AIDEV_SECRET_AGENT_E2E_PA"), "secret reference shown on the agents page");
    });
  } finally {
    await browser.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
