/**
 * P3-06 AC-7 — browser E2E for task contract:
 * Maintainer saves contract, verifies prompt preview contains AC;
 * Viewer can view contract and prompt preview, but has no edit form.
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
    const maint = await contextFor(browser, process.env.MAINT_TOKEN);
    const maintPage = await maint.newPage();

    const sampleContract = {
      version: 1,
      objective: "E2E Contract Objective",
      acceptanceCriteria: [
        { id: "AC-1", text: "E2E Acceptance Criteria One" },
        { id: "AC-2", text: "E2E Acceptance Criteria Two" },
      ],
      allowedPaths: ["apps/web/**"],
      forbiddenPaths: ["docs/**"],
      testCommands: [["pnpm", "test"]],
      outOfScope: ["Out of scope item"],
      notes: "E2E test note",
    };

    await step("maintainer opens task contract page", async () => {
      await maintPage.goto(`${BASE}/projects/kanban-e2e/tasks/1/contract`);
      await maintPage.getByRole("heading", { name: /Hợp đồng task #1/ }).waitFor();
    });

    await step("maintainer fills and saves contract", async () => {
      const textarea = maintPage.getByLabel("Nội dung JSON hợp đồng (TaskContract):");
      await textarea.fill(JSON.stringify(sampleContract, null, 2));
      await maintPage.getByRole("button", { name: "Lưu hợp đồng" }).click();
      await maintPage.getByText("Lưu hợp đồng thành công.").waitFor();
    });

    await step("maintainer sees prompt preview containing AC and objective", async () => {
      const promptPreview = maintPage.getByTestId("prompt-preview");
      await promptPreview.waitFor();
      const text = await promptPreview.innerText();
      assert.ok(text.includes("E2E Contract Objective"), "Prompt should contain objective");
      assert.ok(text.includes("AC-1"), "Prompt should contain AC-1");
      assert.ok(text.includes("E2E Acceptance Criteria One"), "Prompt should contain AC text");
    });

    const viewer = await contextFor(browser, process.env.VIEWER_TOKEN);
    const viewerPage = await viewer.newPage();

    await step("viewer opens task contract page and sees contract details", async () => {
      await viewerPage.goto(`${BASE}/projects/kanban-e2e/tasks/1/contract`);
      await viewerPage.getByRole("heading", { name: /Hợp đồng task #1/ }).waitFor();
      await viewerPage.getByTestId("ac-AC-1").waitFor();
      const promptPreview = viewerPage.getByTestId("prompt-preview");
      await promptPreview.waitFor();
      const text = await promptPreview.innerText();
      assert.ok(text.includes("E2E Contract Objective"), "Viewer should see prompt preview");
    });

    await step("viewer has no edit form", async () => {
      const formCount = await viewerPage.getByRole("form", { name: "Biểu mẫu hợp đồng task" }).count();
      assert.equal(formCount, 0, "Viewer must not see edit form");
    });
  } finally {
    await browser.close();
  }

  for (const r of results) console.log(r);
  if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
})();
