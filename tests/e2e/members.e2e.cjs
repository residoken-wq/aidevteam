/**
 * P2-04 — browser E2E for role editor (org members):
 * (a) org_admin grants role viewer to an allowlisted fake user (900000088) -> visible in table -> revokes it -> disappears;
 * (b) maintainer opens /members -> does not see members data (403 or permission explanation).
 * Fake data only. See tests/e2e/README.md.
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

const BASE = process.env.BASE_URL;

async function contextFor(browser, token) {
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
    const adminCtx = await contextFor(browser, process.env.ADMIN_TOKEN);
    const page = await adminCtx.newPage();

    await step("allowlist fake user via psql and grant role viewer in UI", async () => {
      const dbUrl = process.env.DATABASE_URL;
      assert.ok(dbUrl, "DATABASE_URL is required");

      const fakeId = 900000088;
      execFileSync("psql", [
        "-w",
        "-X",
        "-q",
        "-d",
        dbUrl,
        "-c",
        `INSERT INTO user_allowlist (github_user_id, note) VALUES (${fakeId}, 'e2e fake user') ON CONFLICT DO NOTHING;`,
      ]);

      await page.goto(`${BASE}/members`);
      await page.getByRole("heading", { name: /Thành viên/ }).waitFor();

      // Fill form to grant viewer role
      const form = page.getByRole("form", { name: "Gán vai trò" });
      await form.getByLabel("GitHub ID").fill(String(fakeId));
      await form.getByLabel("Vai trò").selectOption("viewer");
      await form.getByRole("button", { name: "Gán vai trò" }).click();

      // Member row should appear in the table
      const row = page.getByTestId(`member-${fakeId}`);
      await row.waitFor();
      await row.getByRole("cell", { name: "Chỉ xem", exact: true }).waitFor();
    });

    await step("revoke role viewer in UI and row disappears", async () => {
      const fakeId = 900000088;
      const revokeBtn = page.getByTestId(`revoke-${fakeId}-viewer`);
      await revokeBtn.click();

      await page.getByTestId(`member-${fakeId}`).waitFor({ state: "detached" });
    });

    const maintCtx = await contextFor(browser, process.env.MAINT_TOKEN);
    const maintPage = await maintCtx.newPage();

    await step("maintainer opens /members and cannot see member data", async () => {
      await maintPage.goto(`${BASE}/members`);
      await maintPage.getByText("Bạn chưa có quyền xem thành viên trong tổ chức này.").waitFor();

      // Form and table must not exist
      assert.equal(await maintPage.locator("table").count(), 0);
      assert.equal(await maintPage.getByRole("form", { name: "Gán vai trò" }).count(), 0);
    });
  } finally {
    await browser.close();
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
