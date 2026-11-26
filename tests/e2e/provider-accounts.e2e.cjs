/**
 * P2-07 AC-8 — browser E2E for provider accounts: create → pasted secret refused and wiped from the page →
 * rotate the reference → archive; viewer is read-only. Fake data only. See tests/e2e/README.md.
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.BASE_URL;
const FAKE_KEY = "sk-ant-" + "api03-E2EFakeFakeFakeFakeFakeFake";

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
    const page = await (await contextFor(browser, process.env.MAINT_TOKEN)).newPage();
    page.on("dialog", (d) => d.accept());

    await step("maintainer creates a provider account with a reference", async () => {
      await page.goto(`${BASE}/provider-accounts`);
      await page.getByLabel("Mã (slug)").fill("claude-e2e");
      await page.getByLabel("Tên").fill("Claude E2E");
      await page.locator('select[name="provider"]').selectOption("anthropic");
      await page.getByLabel("Tham chiếu secret").fill("env:AIDEV_SECRET_CLAUDE_E2E");
      await page.getByRole("button", { name: "Tạo tài khoản" }).click();
      await page.getByTestId("pa-claude-e2e").filter({ hasText: "env:AIDEV_SECRET_CLAUDE_E2E" }).waitFor();
    });

    await step("pasting a real-looking key is refused, explained, and wiped from the page", async () => {
      await page.getByLabel("Mã (slug)").fill("pasted-key");
      await page.getByLabel("Tên").fill("Pasted");
      await page.getByLabel("Tham chiếu secret").fill(FAKE_KEY);
      await page.getByRole("button", { name: "Tạo tài khoản" }).click();
      await page.getByRole("alert").filter({ hasText: "Không dán secret" }).waitFor();
      assert.equal(await page.getByLabel("Tham chiếu secret").inputValue(), "");
      assert.ok(!(await page.content()).includes(FAKE_KEY), "key still present in the DOM");
      assert.equal(await page.getByTestId("pa-pasted-key").count(), 0);
    });

    await step("rotate the reference", async () => {
      const row = page.getByTestId("pa-claude-e2e");
      await row.getByRole("button", { name: "Đổi tham chiếu" }).click();
      await row.locator('input[name="secretRef"]').fill("file:/run/secrets/claude-e2e-v2");
      await row.getByRole("button", { name: "Lưu" }).click();
      await page.getByTestId("pa-claude-e2e").filter({ hasText: "file:/run/secrets/claude-e2e-v2" }).waitFor();
    });

    await step("rotating to a pasted key is refused and the old reference stays", async () => {
      const row = page.getByTestId("pa-claude-e2e");
      await row.getByRole("button", { name: "Đổi tham chiếu" }).click();
      await row.locator('input[name="secretRef"]').fill(FAKE_KEY);
      await row.getByRole("button", { name: "Lưu" }).click();
      await row.getByRole("alert").filter({ hasText: "Không dán secret" }).waitFor();
      assert.ok(!(await page.content()).includes(FAKE_KEY));
      await page.reload();
      await page.getByTestId("pa-claude-e2e").filter({ hasText: "file:/run/secrets/claude-e2e-v2" }).waitFor();
    });

    await step("archive the account", async () => {
      await page.getByTestId("pa-claude-e2e").getByRole("button", { name: "Lưu trữ" }).click();
      await page.getByTestId("pa-claude-e2e").waitFor({ state: "detached" });
    });

    const vpage = await (await contextFor(browser, process.env.VIEWER_TOKEN)).newPage();
    await step("viewer sees references but cannot create, rotate or archive", async () => {
      await vpage.goto(`${BASE}/provider-accounts?archived=true`);
      await vpage.getByTestId("pa-claude-e2e").waitFor();
      assert.equal(await vpage.getByRole("button", { name: "Tạo tài khoản" }).count(), 0);
      assert.equal(await vpage.getByRole("button", { name: "Đổi tham chiếu" }).count(), 0);
    });
  } finally {
    await browser.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
