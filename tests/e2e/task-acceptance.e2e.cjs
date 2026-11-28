/**
 * P3-10 — browser E2E for task acceptance flow:
 * Create -> assign -> block -> ready -> dispatch; authorization and access control.
 * Fake data only. See tests/e2e/README.md.
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.BASE_URL;
const PROJ = "proj-accept-e2e";

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

  const inCol = (page, status, n) => page.getByTestId(`col-${status}`).getByTestId(`task-${n}`);
  const moveVia = async (page, n, label) => {
    const card = page.getByTestId(`task-${n}`);
    await card.getByLabel("Chuyển sang").selectOption({ label });
    const done = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes(`/tasks/${n}/transitions`),
    );
    await card.getByRole("button", { name: "Chuyển" }).click();
    await done;
  };

  let runAId = "";
  let runBId = "";

  try {
    const maintCtx = await contextFor(browser, process.env.MAINT_TOKEN);
    const adminCtx = await contextFor(browser, process.env.ADMIN_TOKEN);
    const viewerCtx = await contextFor(browser, process.env.VIEWER_TOKEN);
    const pmCtx = await contextFor(browser, process.env.PM_TOKEN);

    const maintPage = await maintCtx.newPage();
    maintPage.on("dialog", (d) => d.accept());

    await step("Step 1: maintainer and admin setup project, epic, sprint, licensed provider account, agent, and mock worker", async () => {
      // Maintainer creates project
      const p = await maintCtx.request.post(`${BASE}/api/projects`, {
        data: { slug: PROJ, name: "Acceptance E2E Project" },
        headers: { Origin: BASE },
      });
      assert.ok(p.ok() || p.status() === 409, `create project failed: ${p.status()}`);

      // Maintainer creates epic
      const ep = await maintCtx.request.post(`${BASE}/api/projects/${PROJ}/epics`, {
        data: { slug: "epic-accept", title: "Acceptance Epic" },
        headers: { Origin: BASE },
      });
      assert.ok(ep.ok() || ep.status() === 409, `create epic failed: ${ep.status()}`);

      // Maintainer creates sprint
      const sp = await maintCtx.request.post(`${BASE}/api/projects/${PROJ}/sprints`, {
        data: { name: "Sprint 1", startDate: "2026-12-01", endDate: "2026-12-14" },
        headers: { Origin: BASE },
      });
      assert.ok(sp.ok() || sp.status() === 409, `create sprint failed: ${sp.status()}`);

      // Maintainer creates provider account
      const pa = await maintCtx.request.post(`${BASE}/api/provider-accounts`, {
        data: {
          slug: "pa-accept-e2e",
          name: "PA Accept E2E",
          provider: "anthropic",
          secretRef: "env:AIDEV_SECRET_PA_ACCEPT_E2E",
        },
        headers: { Origin: BASE },
      });
      assert.ok(pa.ok() || pa.status() === 409, `create provider account failed: ${pa.status()}`);

      // Org admin approves license
      const lic = await adminCtx.request.post(`${BASE}/api/provider-accounts/pa-accept-e2e/license`, {
        data: { licenseStatus: "approved" },
        headers: { Origin: BASE },
      });
      assert.ok(lic.ok() || lic.status() === 200, `approve license failed: ${lic.status()}`);

      // Maintainer creates agent with capability 'backend' and maxActiveTasks: 1
      const ag = await maintCtx.request.post(`${BASE}/api/agents`, {
        data: {
          slug: "agent-accept-e2e",
          name: "Agent Accept E2E",
          capabilities: ["backend"],
          maxActiveTasks: 1,
          providerAccountSlug: "pa-accept-e2e",
        },
        headers: { Origin: BASE },
      });
      assert.ok(ag.ok() || ag.status() === 409, `create agent failed: ${ag.status()}`);

      // Maintainer creates worker mock assigned to project
      const wk = await maintCtx.request.post(`${BASE}/api/workers`, {
        data: {
          slug: "worker-accept-e2e",
          name: "Worker Accept E2E",
          type: "mock",
          workspacePath: "/srv/e2e/accept-worker-e2e",
          projectSlug: PROJ,
        },
        headers: { Origin: BASE },
      });
      assert.ok(wk.ok() || wk.status() === 409, `create worker failed: ${wk.status()}`);
    });

    await step("Step 2: maintainer creates task A (assigned to agent via UI) and task B", async () => {
      await maintPage.goto(`${BASE}/projects/${PROJ}/tasks`);
      await maintPage.getByRole("heading", { name: /Task — Acceptance E2E Project/ }).waitFor();

      // Create Task A via UI form and assign agent
      const f = maintPage.getByRole("form", { name: "Tạo task" });
      await f.getByLabel("Tiêu đề").fill("Task A Prerequisite");
      await f.locator('select[name="agentSlug"]').selectOption("agent-accept-e2e");
      await f.getByLabel("Năng lực yêu cầu (cách nhau bởi dấu phẩy)").fill("backend");
      await f.getByRole("button", { name: "Tạo task" }).click();

      // Verify Task A card appears in BACKLOG with agent assigned
      await inCol(maintPage, "BACKLOG", 1).waitFor();
      const cardA = maintPage.getByTestId("task-1");
      await cardA.filter({ hasText: "Agent: agent-accept-e2e" }).waitFor();

      // Create Task B via UI form
      await f.getByLabel("Tiêu đề").fill("Task B Dependent");
      await f.locator('select[name="agentSlug"]').selectOption("");
      await f.getByRole("button", { name: "Tạo task" }).click();

      // Verify Task B card appears in BACKLOG
      await inCol(maintPage, "BACKLOG", 2).waitFor();
    });

    await step("Step 3: B depends on A -> B displays 'Bị chặn'; dispatch B is rejected with task_blocked and no run created", async () => {
      // Move Task B to TODO so dispatch form is available
      await moveVia(maintPage, 2, "Cần làm");
      await inCol(maintPage, "TODO", 2).waitFor();

      // Open dependency details on card B and add dependency on 1
      const cardB = inCol(maintPage, "TODO", 2);
      const depsDetails = cardB.getByTestId("task-2-deps");
      await depsDetails.locator("summary").click();

      const depForm = cardB.getByRole("form", { name: "Thêm phụ thuộc cho task #2" });
      await depForm.getByLabel("Số task phụ thuộc").fill("1");
      const postDep = maintPage.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/tasks/2/dependencies"),
      );
      await depForm.getByRole("button", { name: "Thêm phụ thuộc" }).click();
      await postDep;

      // Card B now displays "Bị chặn"
      const blockedLabel = cardB.getByTestId("task-2-blocked");
      await blockedLabel.waitFor();
      assert.match(await blockedLabel.textContent(), /Bị chặn/);

      // Attempt to dispatch B -> confirmation dialog -> 409 task_blocked
      const dispatchForm = cardB.getByRole("form", { name: "Chạy mock task #2" });
      const postDisp = maintPage.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/tasks/2/dispatch"),
      );
      await dispatchForm.getByRole("button", { name: "Chạy mock" }).click();

      const confirmDialog = maintPage.locator("dialog[open]");
      await confirmDialog.waitFor();
      await confirmDialog.getByRole("button", { name: "Xác nhận", exact: true }).click();

      const res = await postDisp;
      assert.equal(res.status(), 409, "Dispatching blocked task must return 409 Conflict");

      // Error message is displayed in dispatch form
      const errorMsg = dispatchForm.getByRole("alert");
      await errorMsg.waitFor();
      assert.match(await errorMsg.textContent(), /chặn|task_blocked/i);
      assert.ok(maintPage.url().includes(`/projects/${PROJ}/tasks`), "Should stay on board page");
    });

    await step("Step 4: assigning second task to agent already at capacity reports agent_at_capacity", async () => {
      // Move task A to TODO -> agent-accept-e2e now has 1 active task (at capacity 1/1)
      await moveVia(maintPage, 1, "Cần làm");
      await inCol(maintPage, "TODO", 1).waitFor();

      // Attempt to assign agent-accept-e2e to task B via UI create form -> rejected
      const f = maintPage.getByRole("form", { name: "Tạo task" });
      await f.getByLabel("Tiêu đề").fill("Task C Capacity Rejection");
      await f.locator('select[name="agentSlug"]').selectOption("agent-accept-e2e");
      await f.getByLabel("Năng lực yêu cầu (cách nhau bởi dấu phẩy)").fill("backend");
      await f.getByRole("button", { name: "Tạo task" }).click();

      await maintPage.getByRole("alert").filter({ hasText: "tối đa" }).waitFor();

      // Attempt via API PATCH on task 2 -> returns 409 agent_at_capacity
      const patchRes = await maintCtx.request.patch(`${BASE}/api/projects/${PROJ}/tasks/2`, {
        data: { agentSlug: "agent-accept-e2e" },
        headers: { Origin: BASE },
      });
      assert.equal(patchRes.status(), 409);
      const patchBody = await patchRes.json();
      assert.equal(patchBody.message, "agent_at_capacity");
    });

    await step("Step 5: dispatch A -> run in /runs; walk A to DONE -> B unblocks -> dispatch B succeeds", async () => {
      // Dispatch task A
      const cardA = inCol(maintPage, "TODO", 1);
      const dispFormA = cardA.getByRole("form", { name: "Chạy mock task #1" });
      await dispFormA.getByRole("button", { name: "Chạy mock" }).click();

      const confirmDialog = maintPage.locator("dialog[open]");
      await confirmDialog.waitFor();
      await confirmDialog.getByRole("button", { name: "Xác nhận", exact: true }).click();

      await maintPage.waitForURL(/\/runs\/[0-9a-f-]{36}/);
      const runAUrl = maintPage.url();
      runAId = runAUrl.split("/runs/")[1];
      assert.ok(runAId, "runAId should be defined");

      // Verify run A appears in /runs
      await maintPage.goto(`${BASE}/runs`);
      await maintPage.getByRole("link", { name: runAId }).waitFor();

      // Cancel run A to free worker mock
      await maintCtx.request.post(`${BASE}/api/runs/${runAId}/cancel`, {
        headers: { Origin: BASE },
      });

      // Return to Kanban board and walk task A to DONE
      await maintPage.goto(`${BASE}/projects/${PROJ}/tasks`);
      await inCol(maintPage, "TODO", 1).waitFor();

      await moveVia(maintPage, 1, "Đang làm");
      await inCol(maintPage, "IN_PROGRESS", 1).waitFor();
      await moveVia(maintPage, 1, "Đang review");
      await inCol(maintPage, "IN_REVIEW", 1).waitFor();
      await moveVia(maintPage, 1, "Hoàn thành");
      await inCol(maintPage, "DONE", 1).waitFor();

      // Task B is now unblocked
      await maintPage.reload();
      const cardB = inCol(maintPage, "TODO", 2);
      await cardB.waitFor();
      assert.equal(await cardB.getByTestId("task-2-blocked").count(), 0, "Task B should no longer show Bị chặn");

      // Dispatch task B now succeeds
      const dispFormB = cardB.getByRole("form", { name: "Chạy mock task #2" });
      await dispFormB.getByRole("button", { name: "Chạy mock" }).click();

      const confirmDialogB = maintPage.locator("dialog[open]");
      await confirmDialogB.waitFor();
      await confirmDialogB.getByRole("button", { name: "Xác nhận", exact: true }).click();

      await maintPage.waitForURL(/\/runs\/[0-9a-f-]{36}/);
      const runBUrl = maintPage.url();
      runBId = runBUrl.split("/runs/")[1];
      assert.ok(runBId, "runBId should be defined");

      const statusEl = maintPage.getByTestId("run-status");
      await statusEl.waitFor();
      assert.match(await statusEl.textContent(), /QUEUED/);
    });

    await step("Step 6: comment on B; timeline of B displays events and comment in order", async () => {
      // Open task 2 detail page
      await maintPage.goto(`${BASE}/projects/${PROJ}/tasks/2`);
      const section = maintPage.getByTestId("task-activity-section");
      await section.waitFor();

      // Post comment
      const textarea = section.getByRole("textbox", { name: "Nội dung bình luận" });
      await textarea.fill("Acceptance comment on Task B");
      await section.getByRole("button", { name: "Gửi bình luận" }).click();

      // Verify comment appears in activity timeline
      await section.getByTestId("comment-body").filter({ hasText: "Acceptance comment on Task B" }).waitFor();

      // Verify activity events via API
      const actRes = await maintCtx.request.get(`${BASE}/api/projects/${PROJ}/tasks/2/activity`);
      assert.ok(actRes.ok());
      const actData = await actRes.json();
      const actions = (actData.items ?? []).map((i) => i.action ?? i.kind);
      assert.ok(actions.includes("task.created"));
      assert.ok(actions.includes("task.dependency_added"));
      assert.ok(actions.includes("task.transitioned"));
      assert.ok(actions.includes("comment"));

      // Verify ascending order
      for (let i = 1; i < actData.items.length; i++) {
        const prev = new Date(actData.items[i - 1].at).getTime();
        const curr = new Date(actData.items[i].at).getTime();
        assert.ok(curr >= prev, "Activity items must be chronologically ordered");
      }
    });

    await step("Step 7a: viewer cannot create task, assign agent, add dependency, dispatch, cancel run, or post comment (all 403, UI controls absent)", async () => {
      // API checks for viewer
      const createRes = await viewerCtx.request.post(`${BASE}/api/projects/${PROJ}/tasks`, {
        data: { title: "Viewer Task" },
        headers: { Origin: BASE },
      });
      assert.equal(createRes.status(), 403);

      const patchRes = await viewerCtx.request.patch(`${BASE}/api/projects/${PROJ}/tasks/2`, {
        data: { agentSlug: "agent-accept-e2e" },
        headers: { Origin: BASE },
      });
      assert.equal(patchRes.status(), 403);

      const depRes = await viewerCtx.request.post(`${BASE}/api/projects/${PROJ}/tasks/2/dependencies`, {
        data: { dependsOn: 1 },
        headers: { Origin: BASE },
      });
      assert.equal(depRes.status(), 403);

      const dispRes = await viewerCtx.request.post(`${BASE}/api/projects/${PROJ}/tasks/2/dispatch`, {
        data: { workerSlug: "worker-accept-e2e" },
        headers: { Origin: BASE },
      });
      assert.equal(dispRes.status(), 403);

      const cancelRes = await viewerCtx.request.post(`${BASE}/api/runs/${runBId}/cancel`, {
        headers: { Origin: BASE },
      });
      assert.equal(cancelRes.status(), 403);

      const commentRes = await viewerCtx.request.post(`${BASE}/api/projects/${PROJ}/tasks/2/comments`, {
        data: { body: "Viewer comment attempt" },
        headers: { Origin: BASE },
      });
      assert.equal(commentRes.status(), 403);

      // UI checks for viewer
      const viewerPage = await viewerCtx.newPage();
      await viewerPage.goto(`${BASE}/projects/${PROJ}/tasks`);
      assert.equal(await viewerPage.getByRole("form", { name: "Tạo task" }).count(), 0);
      assert.equal(await viewerPage.getByRole("button", { name: "Chuyển" }).count(), 0);
      assert.equal(await viewerPage.getByRole("button", { name: "Chạy mock" }).count(), 0);

      await viewerPage.goto(`${BASE}/projects/${PROJ}/tasks/2`);
      assert.equal(await viewerPage.getByRole("textbox", { name: "Nội dung bình luận" }).count(), 0);

      await viewerPage.goto(`${BASE}/runs/${runBId}`);
      assert.equal(await viewerPage.getByRole("button", { name: "Hủy" }).count(), 0);
    });

    await step("Step 7b: unassigned project_member cannot view project, tasks, run, or activity (404), and search/runs exclude data", async () => {
      assert.equal((await pmCtx.request.get(`${BASE}/api/projects/${PROJ}`)).status(), 404);
      assert.equal((await pmCtx.request.get(`${BASE}/api/projects/${PROJ}/tasks`)).status(), 404);
      assert.equal((await pmCtx.request.get(`${BASE}/api/projects/${PROJ}/tasks/1`)).status(), 404);
      assert.equal((await pmCtx.request.get(`${BASE}/api/projects/${PROJ}/tasks/2`)).status(), 404);
      assert.equal((await pmCtx.request.get(`${BASE}/api/projects/${PROJ}/tasks/2/activity`)).status(), 404);
      assert.equal((await pmCtx.request.get(`${BASE}/api/runs/${runBId}`)).status(), 404);

      // Search tasks
      const searchRes = await pmCtx.request.get(`${BASE}/api/tasks/search?q=Task`);
      assert.ok(searchRes.ok());
      const searchData = await searchRes.json();
      const slugs = (searchData.items ?? []).map((t) => t.projectSlug);
      assert.ok(!slugs.includes(PROJ), "Search must not include unassigned project tasks");

      // Runs list
      const runsRes = await pmCtx.request.get(`${BASE}/api/runs`);
      assert.ok(runsRes.ok());
      const runsData = await runsRes.json();
      const runIds = (runsData.items ?? []).map((r) => r.id);
      assert.ok(!runIds.includes(runAId), "Runs must not include unassigned project runs");
      assert.ok(!runIds.includes(runBId), "Runs must not include unassigned project runs");
    });

    await step("Step 7c: request body containing unknown orgId or projectId is rejected with 422", async () => {
      const foreignId = "11111111-1111-1111-1111-111111111111";

      const taskOrgRes = await maintCtx.request.post(`${BASE}/api/projects/${PROJ}/tasks`, {
        data: { title: "Strict Task", orgId: foreignId },
        headers: { Origin: BASE },
      });
      assert.equal(taskOrgRes.status(), 422);

      const taskProjRes = await maintCtx.request.post(`${BASE}/api/projects/${PROJ}/tasks`, {
        data: { title: "Strict Task", projectId: foreignId },
        headers: { Origin: BASE },
      });
      assert.equal(taskProjRes.status(), 422);

      const patchRes = await maintCtx.request.patch(`${BASE}/api/projects/${PROJ}/tasks/2`, {
        data: { orgId: foreignId },
        headers: { Origin: BASE },
      });
      assert.equal(patchRes.status(), 422);

      const depRes = await maintCtx.request.post(`${BASE}/api/projects/${PROJ}/tasks/2/dependencies`, {
        data: { dependsOn: 1, orgId: foreignId },
        headers: { Origin: BASE },
      });
      assert.equal(depRes.status(), 422);

      const commentRes = await maintCtx.request.post(`${BASE}/api/projects/${PROJ}/tasks/2/comments`, {
        data: { body: "Strict Comment", orgId: foreignId },
        headers: { Origin: BASE },
      });
      assert.equal(commentRes.status(), 422);

      const dispRes = await maintCtx.request.post(`${BASE}/api/projects/${PROJ}/tasks/2/dispatch`, {
        data: { workerSlug: "worker-accept-e2e", orgId: foreignId },
        headers: { Origin: BASE },
      });
      assert.equal(dispRes.status(), 422);
    });
  } finally {
    await browser.close();
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
