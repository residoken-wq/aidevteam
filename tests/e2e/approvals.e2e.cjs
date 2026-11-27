/**
 * P6-06 — browser E2E for release approvals (read-only):
 * (a) org seed chưa có approval → trang hiện banner + "Chưa có bản ghi duyệt", không có button/form;
 * (b) chèn 1 bản ghi giả bằng psql qua child_process.execFileSync('psql', [...argv mảng...]) với DATABASE_URL từ env —
 *     pipeline_run_id bắt đầu TEST-, approver_github_user_id 900000099, sha/digest giả, source_comment_url dạng github hợp lệ —
 *     rồi tải lại: thấy đủ các cột, environment hiện đúng, không có button/form, và vì APPROVAL_REPO không cấu hình
 *     trong E2E nên KHÔNG có thẻ a tới github.com;
 * (c) viewer xem được.
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
    const maint = await contextFor(browser, process.env.MAINT_TOKEN);
    const page = await maint.newPage();

    await step("maintainer opens approvals: empty org shows banner and 'Chưa có bản ghi duyệt', no button/form", async () => {
      await page.goto(`${BASE}/approvals`);
      await page.getByRole("heading", { name: /Duyệt release/ }).waitFor();
      await page.getByText("Chỉ hiển thị. Quyết định được thực hiện bằng comment /approve-* trên PR.").waitFor();
      await page.getByText("Chưa có bản ghi duyệt").waitFor();

      const buttonCount = await page.locator("button").count();
      assert.equal(buttonCount, 0, "approvals page must not contain any button elements");
      const formCount = await page.locator("form").count();
      assert.equal(formCount, 0, "approvals page must not contain any form elements");
    });

    await step("insert fake approval record via psql and reload", async () => {
      const dbUrl = process.env.DATABASE_URL;
      assert.ok(dbUrl, "DATABASE_URL is required");

      const insertSql = `
        INSERT INTO release_approvals (
          org_id, environment, decision, target_sha, release_manifest_digest,
          pipeline_run_id, approver_github_user_id, source_comment_url, decided_at
        )
        SELECT id, 'uat', 'approved', '0123456789abcdef0123456789abcdef01234567',
               'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
               'TEST-pipeline-run-001', 900000099,
               'https://github.com/example-owner/example-repo/pull/1#issuecomment-999999',
               now()
        FROM orgs WHERE slug = 'org-test-a'
        LIMIT 1;
      `;

      execFileSync("psql", ["-w", "-X", "-q", "-d", dbUrl, "-c", insertSql]);

      await page.reload();
      await page.getByRole("heading", { name: /Duyệt release/ }).waitFor();

      // Check all column headers
      const headers = [
        "Môi trường",
        "Quyết định",
        "Commit (target_sha)",
        "Digest",
        "Pipeline run",
        "Người duyệt (GitHub ID số)",
        "Thời điểm quyết định",
        "Thời điểm ghi",
        "Nguồn",
      ];
      for (const h of headers) {
        await page.getByRole("columnheader", { name: h }).waitFor();
      }

      // Check row values
      await page.getByRole("cell", { name: "uat" }).waitFor();
      await page.getByRole("cell", { name: "approved" }).waitFor();
      await page.getByText("TEST-pipeline-run-001").waitFor();
      await page.getByText("900000099").waitFor();

      // Check no button / form
      const buttonCount = await page.locator("button").count();
      assert.equal(buttonCount, 0, "approvals page must not contain any button elements");
      const formCount = await page.locator("form").count();
      assert.equal(formCount, 0, "approvals page must not contain any form elements");

      // APPROVAL_REPO is not configured in E2E, so sourceCommentUrl is null, no link to github.com
      const githubLinksCount = await page.locator("a[href*='github.com']").count();
      assert.equal(githubLinksCount, 0, "must not contain any link to github.com when APPROVAL_REPO is unconfigured");
      await page.getByRole("cell", { name: "—" }).waitFor();
    });

    await step("viewer can view the approvals page", async () => {
      const viewerCtx = await contextFor(browser, process.env.VIEWER_TOKEN);
      const vpage = await viewerCtx.newPage();

      await vpage.goto(`${BASE}/approvals`);
      await vpage.getByRole("heading", { name: /Duyệt release/ }).waitFor();
      await vpage.getByText("Chỉ hiển thị. Quyết định được thực hiện bằng comment /approve-* trên PR.").waitFor();

      await vpage.getByRole("cell", { name: "uat" }).waitFor();
      await vpage.getByRole("cell", { name: "approved" }).waitFor();
      await vpage.getByText("TEST-pipeline-run-001").waitFor();

      const buttonCount = await vpage.locator("button").count();
      assert.equal(buttonCount, 0, "approvals page for viewer must not contain buttons");
      const formCount = await vpage.locator("form").count();
      assert.equal(formCount, 0, "approvals page for viewer must not contain forms");

      const githubLinksCount = await vpage.locator("a[href*='github.com']").count();
      assert.equal(githubLinksCount, 0, "must not contain any link to github.com");
    });
  } finally {
    await browser.close();
  }

  for (const r of results) console.log(r);
  if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
})();
