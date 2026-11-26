/**
 * P2-08 — browser E2E for mock workers: create with a project → overlapping workspace refused →
 * disable/enable → archive frees the path; viewer is read-only. Fake data only. See tests/e2e/README.md.
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
  const create = async (page, slug, path, project) => {
    await page.getByLabel("Mã (slug)").fill(slug);
    await page.getByLabel("Tên").fill(`Worker ${slug}`);
    await page.getByLabel("Thư mục làm việc").fill(path);
    if (project) await page.locator('select[name="projectSlug"]').selectOption(project);
    await page.getByRole("button", { name: "Tạo worker" }).click();
  };
  try {
    const page = await (await contextFor(browser, process.env.MAINT_TOKEN)).newPage();
    page.on("dialog", (d) => d.accept());

    await step("maintainer creates a mock worker attached to a project", async () => {
      await page.goto(`${BASE}/projects`);
      await page.getByLabel("Mã (slug)").fill("worker-e2e-proj");
      await page.getByLabel("Tên").fill("Worker E2E Project");
      await page.getByRole("button", { name: "Tạo dự án" }).click();
      await page.getByText("worker-e2e-proj").first().waitFor();
      await page.goto(`${BASE}/workers`);
      await create(page, "mock-e2e", "/srv/e2e/mock", "worker-e2e-proj");
      const row = page.getByTestId("worker-mock-e2e");
      await row.filter({ hasText: "/srv/e2e/mock" }).filter({ hasText: "worker-e2e-proj" }).filter({ hasText: "Đang bật" }).waitFor();
    });

    await step("a nested workspace path is refused with an explanation", async () => {
      await create(page, "nested-e2e", "/srv/e2e/mock/inner");
      await page.getByRole("alert").filter({ hasText: "Thư mục làm việc trùng" }).waitFor();
      assert.equal(await page.getByTestId("worker-nested-e2e").count(), 0);
    });

    await step("a system path is refused", async () => {
      await create(page, "etc-e2e", "/etc/aidevteam");
      await page.getByRole("alert").filter({ hasText: "workspacePath" }).waitFor();
      assert.equal(await page.getByTestId("worker-etc-e2e").count(), 0);
    });

    await step("disable then enable", async () => {
      const row = page.getByTestId("worker-mock-e2e");
      await row.getByRole("button", { name: "Tắt" }).click();
      await row.filter({ hasText: "Đã tắt" }).waitFor();
      await row.getByRole("button", { name: "Bật" }).click();
      await row.filter({ hasText: "Đang bật" }).waitFor();
    });

    await step("archive frees the workspace path", async () => {
      await page.getByTestId("worker-mock-e2e").getByRole("button", { name: "Lưu trữ" }).click();
      await page.getByTestId("worker-mock-e2e").waitFor({ state: "detached" });
      await create(page, "mock-e2e-2", "/srv/e2e/mock");
      await page.getByTestId("worker-mock-e2e-2").waitFor();
    });

    const vpage = await (await contextFor(browser, process.env.VIEWER_TOKEN)).newPage();
    await step("viewer sees workers but cannot create, toggle or archive", async () => {
      await vpage.goto(`${BASE}/workers?archived=true`);
      await vpage.getByTestId("worker-mock-e2e").waitFor();
      assert.equal(await vpage.getByRole("button", { name: "Tạo worker" }).count(), 0);
      assert.equal(await vpage.getByRole("button", { name: "Tắt" }).count(), 0);
      assert.equal(await vpage.getByRole("button", { name: "Lưu trữ" }).count(), 0);
    });
  } finally {
    await browser.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
