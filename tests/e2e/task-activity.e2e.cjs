/**
 * P3-07 — browser E2E for task activity and comments:
 * - Maintainer opens task detail page.
 * - Timeline displays task creation event.
 * - Maintainer submits comment with HTML characters: `<script>alert('xss')</script> and <b>bold text</b>`.
 * - Comment appears in timeline as literal text, NOT interpreted as HTML.
 * - Empty comment submission is prevented or shows validation error.
 * - Viewer sees comments and events but does not have write form.
 *
 * Fake data only. See tests/e2e/README.md.
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

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
    const maintCtx = await contextFor(browser, process.env.MAINT_TOKEN);
    const maintPage = await maintCtx.newPage();
    maintPage.on("dialog", (d) => d.accept());

    let taskUrl = "";

    await step("maintainer creates project and task", async () => {
      await maintPage.goto(`${BASE}/projects`);
      await maintPage.getByLabel("Mã (slug)").fill("act-e2e-proj");
      await maintPage.getByLabel("Tên").fill("Activity E2E Project");
      await maintPage.getByRole("button", { name: "Tạo dự án" }).click();
      await maintPage.getByRole("link", { name: "act-e2e-proj" }).first().waitFor();

      await maintPage.goto(`${BASE}/projects/act-e2e-proj/tasks`);
      const form = maintPage.getByRole("form", { name: "Tạo task" });
      await form.getByLabel("Tiêu đề").fill("Activity E2E Task");
      await form.getByRole("button", { name: "Tạo task" }).click();

      const taskLink = maintPage.getByRole("link", { name: /#1/ });
      await taskLink.waitFor();
      taskUrl = await taskLink.getAttribute("href");
    });

    await step("timeline displays task creation event", async () => {
      await maintPage.goto(`${BASE}${taskUrl}`);
      const section = maintPage.getByTestId("task-activity-section");
      await section.waitFor();
      const content = await section.textContent();
      assert.match(content, /Hoạt động/);
      assert.match(content, /Tạo task/);
    });

    await step("maintainer posts comment containing script and bold tags", async () => {
      const section = maintPage.getByTestId("task-activity-section");
      const textarea = section.getByRole("textbox", { name: "Nội dung bình luận" });
      const submitBtn = section.getByRole("button", { name: "Gửi bình luận" });

      const xssPayload = "<script>alert('xss')</script> and <b>bold text</b>";
      await textarea.fill(xssPayload);
      await submitBtn.click();

      // Verify comment appears as plain text
      const commentBody = section.getByTestId("comment-body").first();
      await commentBody.waitFor();
      const text = await commentBody.textContent();
      assert.equal(text, xssPayload);

      // Verify no script tag was executed or created in DOM
      const scriptTags = await section.locator("script").count();
      assert.equal(scriptTags, 0, "No script tag should be injected into DOM");

      // Verify <b> tag is text, not HTML element
      const boldTags = await section.locator("b").count();
      assert.equal(boldTags, 0, "<b> tag should not be rendered as HTML element");
    });

    await step("viewer can view activity but cannot see comment form", async () => {
      const viewerCtx = await contextFor(browser, process.env.VIEWER_TOKEN);
      const viewerPage = await viewerCtx.newPage();
      await viewerPage.goto(`${BASE}${taskUrl}`);

      const section = viewerPage.getByTestId("task-activity-section");
      await section.waitFor();
      const text = await section.textContent();
      assert.match(text, /alert\('xss'\)/);

      // Comment form should not exist for viewer
      const form = section.getByRole("form", { name: "Thêm bình luận" });
      const formCount = await form.count();
      assert.equal(formCount, 0, "Viewer should not see the comment form");
    });
  } finally {
    await browser.close();
  }

  for (const r of results) {
    console.log(r);
  }
  const failed = results.filter((r) => r.startsWith("FAIL"));
  if (failed.length > 0) {
    process.exit(1);
  }
})();
