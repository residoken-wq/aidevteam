/**
 * P2-06 — browser E2E for agent org chart:
 * maintainer creates 3 agents via API (e2e-lead, e2e-dev-a, e2e-dev-b) →
 * drag e2e-dev-a onto e2e-lead (wait for PATCH response) → reload: e2e-dev-a is under e2e-lead →
 * drag e2e-lead onto e2e-dev-a → cycle error displayed, tree unchanged →
 * use select to move e2e-dev-a back to root → correct →
 * viewer opens page → no [draggable="true"], select, or edit button.
 * Fake data only. See tests/e2e/README.md.
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.BASE_URL;

async function contextFor(browser, token) {
  // Tall viewport: agents left by earlier E2E files push nodes down; HTML5 drag needs both nodes on screen.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 2400 } });
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

  const GRAB = { sourcePosition: { x: 8, y: 6 } };

  try {
    const mctx = await contextFor(browser, process.env.MAINT_TOKEN);
    const mpage = await mctx.newPage();
    mpage.on("dialog", (d) => d.accept());

    await step("maintainer creates 3 fake agents via API", async () => {
      for (const [slug, name, title] of [
        ["e2e-lead", "Lead E2E", "Tech Lead"],
        ["e2e-dev-a", "Dev A E2E", "Backend Dev"],
        ["e2e-dev-b", "Dev B E2E", "Frontend Dev"],
      ]) {
        const res = await mctx.request.post(`${BASE}/api/agents`, {
          data: { slug, name, title },
          headers: { Origin: BASE }, // API requires Origin === PUBLIC_BASE_URL (CSRF guard)
        });
        assert.ok(res.ok() || res.status() === 409, `API create agent ${slug} failed: ${await res.text()}`);
      }
    });

    await step("drag e2e-dev-a onto e2e-lead, after reload e2e-dev-a is under e2e-lead", async () => {
      await mpage.goto(`${BASE}/agents/chart`);
      await mpage.getByTestId("agent-node-e2e-dev-a").waitFor();
      await mpage.getByTestId("agent-node-e2e-lead").waitFor();

      const patchDone = mpage.waitForResponse(
        (r) => r.request().method() === "PATCH" && r.url().includes("/agents/e2e-dev-a"),
      );
      await mpage.getByTestId("agent-node-e2e-dev-a").dragTo(mpage.getByTestId("agent-node-e2e-lead"), GRAB);
      await patchDone;

      await mpage.reload();
      await mpage.getByTestId("agent-node-e2e-lead").getByTestId("agent-node-e2e-dev-a").waitFor();
    });

    await step("drag e2e-lead onto e2e-dev-a shows cycle error and tree does not change", async () => {
      await mpage.getByTestId("agent-node-e2e-lead").dragTo(
        mpage.getByTestId("agent-node-e2e-lead").getByTestId("agent-node-e2e-dev-a"),
        GRAB,
      );
      await mpage.getByRole("alert").filter({ hasText: "vòng lặp" }).waitFor();
      // Tree remains unchanged: e2e-dev-a is still under e2e-lead
      await mpage.getByTestId("agent-node-e2e-lead").getByTestId("agent-node-e2e-dev-a").waitFor();
    });

    await step("use select to move e2e-dev-a back to root", async () => {
      const devA = mpage.getByTestId("agent-node-e2e-dev-a");
      await devA.locator('select[name="reportsToSlug"]').selectOption("");
      const patchDone = mpage.waitForResponse(
        (r) => r.request().method() === "PATCH" && r.url().includes("/agents/e2e-dev-a"),
      );
      await devA.getByRole("button", { name: "Lưu" }).click();
      const res = await patchDone;
      assert.ok(res.ok(), `PATCH to root failed: ${res.status()}`);

      // router.refresh() is async: reload so the assertion reads the server state, not a mid-refresh DOM.
      await mpage.reload();
      await mpage.getByTestId("agent-node-e2e-dev-a").waitFor();
      assert.equal(
        await mpage.getByTestId("agent-node-e2e-lead").getByTestId("agent-node-e2e-dev-a").count(),
        0,
        "e2e-dev-a is still under e2e-lead after moving to root",
      );
    });

    const vctx = await contextFor(browser, process.env.VIEWER_TOKEN);
    const vpage = await vctx.newPage();

    await step("viewer opens org chart and sees no draggable elements, select or edit buttons", async () => {
      await vpage.goto(`${BASE}/agents/chart`);
      await vpage.getByTestId("agent-node-e2e-lead").waitFor();
      await vpage.getByTestId("agent-node-e2e-dev-a").waitFor();

      assert.equal(await vpage.locator('[draggable="true"]').count(), 0, "viewer sees draggable elements");
      assert.equal(await vpage.locator("select").count(), 0, "viewer sees select elements");
      assert.equal(await vpage.locator("main button").count(), 0, "viewer sees buttons");
      assert.equal(await vpage.getByTestId("drop-root").count(), 0, "viewer sees drop root zone");
    });
  } finally {
    await browser.close();
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
