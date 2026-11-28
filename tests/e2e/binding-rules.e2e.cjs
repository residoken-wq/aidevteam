/**
 * P2-09 browser E2E for binding rules:
 * org_admin changes account license to approved -> maintainer can attach to agent;
 * prohibited account -> attachment refused with error message.
 * Fake data only. See tests/e2e/README.md.
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
    const adminPage = await (await contextFor(browser, process.env.ADMIN_TOKEN)).newPage();
    const maintPage = await (await contextFor(browser, process.env.MAINT_TOKEN)).newPage();
    adminPage.on("dialog", (d) => d.accept());
    maintPage.on("dialog", (d) => d.accept());

    await step("maintainer creates a provider account (starts unverified)", async () => {
      await maintPage.goto(`${BASE}/provider-accounts`);
      await maintPage.getByLabel("Mã (slug)").fill("pa-bind-e2e");
      await maintPage.getByLabel("Tên").fill("PA Binding E2E");
      await maintPage.getByLabel("Tham chiếu secret").fill("env:AIDEV_SECRET_PA_BIND_E2E");
      await maintPage.getByRole("button", { name: "Tạo tài khoản" }).click();
      await maintPage.getByTestId("pa-pa-bind-e2e").filter({ hasText: "Chưa xác minh" }).waitFor();
    });

    await step("unverified account is not listed in agent form and direct attachment fails", async () => {
      await maintPage.goto(`${BASE}/agents`);
      const options = await maintPage.locator('select[name="providerAccountSlug"] option').allTextContents();
      assert.ok(!options.includes("pa-bind-e2e"), "unverified account should not be in options");

      // Direct API call attempting to bind unverified account -> 422
      const res = await maintPage.evaluate(async (base) => {
        const r = await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: base },
          body: JSON.stringify({ slug: "agent-unverified-bind", name: "Agent Unverified", providerAccountSlug: "pa-bind-e2e" }),
        });
        const body = await r.json();
        return { status: r.status, body };
      }, BASE);
      assert.equal(res.status, 422);
      assert.equal(res.body.message, "provider_account_not_licensed");
    });

    await step("org_admin approves provider account license", async () => {
      await adminPage.goto(`${BASE}/provider-accounts`);
      const row = adminPage.getByTestId("pa-pa-bind-e2e");
      await row.waitFor();
      await row.locator('select[name="licenseStatus"]').selectOption("approved");
      await row.getByRole("button", { name: "Đổi" }).click();
      await adminPage.getByTestId("pa-pa-bind-e2e").filter({ hasText: "Đã duyệt" }).waitFor();
    });

    await step("maintainer can attach approved account to agent via form", async () => {
      await maintPage.goto(`${BASE}/agents`);
      await maintPage.getByLabel("Mã (slug)").fill("agent-approved-bind");
      await maintPage.getByLabel("Tên", { exact: true }).fill("Agent Approved Bind");
      await maintPage.locator('select[name="providerAccountSlug"]').selectOption("pa-bind-e2e");
      await maintPage.getByRole("button", { name: "Tạo agent" }).click();
      await maintPage.getByTestId("agent-agent-approved-bind").filter({ hasText: "pa-bind-e2e" }).waitFor();
    });

    await step("org_admin demotes account to prohibited", async () => {
      await adminPage.goto(`${BASE}/provider-accounts`);
      const row = adminPage.getByTestId("pa-pa-bind-e2e");
      await row.locator('select[name="licenseStatus"]').selectOption("prohibited");
      await row.getByRole("button", { name: "Đổi" }).click();
      await adminPage.getByTestId("pa-pa-bind-e2e").filter({ hasText: "Cấm" }).waitFor();
    });

    await step("attaching prohibited account is refused with error message", async () => {
      await maintPage.goto(`${BASE}/agents`);
      const res = await maintPage.evaluate(async (base) => {
        const r = await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: base },
          body: JSON.stringify({ slug: "agent-prohibited-bind", name: "Agent Prohibited", providerAccountSlug: "pa-bind-e2e" }),
        });
        const body = await r.json();
        return { status: r.status, body };
      }, BASE);
      assert.equal(res.status, 422);
      assert.equal(res.body.message, "provider_account_not_licensed");
    });
  } finally {
    await browser.close();
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
