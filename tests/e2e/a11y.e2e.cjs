/**
 * P2-11 — Browser E2E for accessibility, keyboard navigation, and profile page.
 * (a) /profile displays fake user GitHub ID number and role, read-only (no button/form in main), no @ email, no session token;
 * (b) First Tab on /dashboard focuses the skip link ("Bỏ qua tới nội dung chính"); Enter moves focus into #main-content;
 * (c) Keyboard navigation through sidebar to "Dự án" link, Enter navigates to /projects with aria-current="page";
 * (d) Accessible names on /projects, /agents, /provider-accounts, /workers, /members for all visible input, select, textarea;
 * (e) Exactly 1 h1 per page and html[lang="vi"];
 * (f) Unauthenticated user visiting /profile redirected to /login.
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
    const adminCtx = await contextFor(browser, process.env.ADMIN_TOKEN);
    const adminPage = await adminCtx.newPage();
    adminPage.on("dialog", (d) => d.accept());

    const maintCtx = await contextFor(browser, process.env.MAINT_TOKEN);
    const maintPage = await maintCtx.newPage();
    maintPage.on("dialog", (d) => d.accept());

    await step("/profile displays correct fake user data, read-only, without email or session token (AC-1)", async () => {
      await adminPage.goto(`${BASE}/profile`);
      await adminPage.getByRole("heading", { name: "Hồ sơ" }).waitFor();

      // Check GitHub ID
      const githubId = await adminPage.locator('[data-testid="profile-github-id"]').textContent();
      assert.ok(githubId.includes("900000001"), `Expected 900000001 in profile, got ${githubId}`);

      // Check role
      const activeOrg = await adminPage.locator('[data-testid="profile-active-org"]').textContent();
      assert.ok(activeOrg.includes("Quản trị tổ chức"), `Expected role label in activeOrg, got ${activeOrg}`);

      // Check read-only: no buttons or forms in main
      const mainButtons = await adminPage.locator("main button").count();
      assert.equal(mainButtons, 0, `Expected 0 buttons in main, found ${mainButtons}`);
      const mainForms = await adminPage.locator("main form").count();
      assert.equal(mainForms, 0, `Expected 0 forms in main, found ${mainForms}`);

      // Check header logout button still exists
      const headerButtons = await adminPage.locator("header").getByRole("button", { name: "Đăng xuất" });
      assert.equal(await headerButtons.count(), 1, "Header must retain logout button");

      // Verify no email address (@) or session token leaked in page content
      const content = await adminPage.content();
      assert.ok(!content.includes("@example.com"), "Page content must not leak email");
      assert.ok(!content.includes("@"), "Page content must not contain '@'");
      assert.ok(!content.includes(process.env.ADMIN_TOKEN), "Page content must not leak session token");

      // Also check maintainer user
      await maintPage.goto(`${BASE}/profile`);
      await maintPage.getByRole("heading", { name: "Hồ sơ" }).waitFor();
      const maintGithubId = await maintPage.locator('[data-testid="profile-github-id"]').textContent();
      assert.ok(maintGithubId.includes("900000003"), `Expected 900000003 in profile, got ${maintGithubId}`);
      const maintActiveOrg = await maintPage.locator('[data-testid="profile-active-org"]').textContent();
      assert.ok(maintActiveOrg.includes("Vận hành"), `Expected 'Vận hành' in activeOrg, got ${maintActiveOrg}`);
    });

    await step("first Tab on /dashboard focuses skip link and Enter moves focus into #main-content (AC-2)", async () => {
      await maintPage.goto(`${BASE}/dashboard`);
      await maintPage.getByRole("heading", { name: /Tổng quan/ }).waitFor();

      // Press Tab for the first time
      await maintPage.keyboard.press("Tab");

      const activeHref = await maintPage.evaluate(() => globalThis.document.activeElement?.getAttribute("href"));
      const activeText = await maintPage.evaluate(() => globalThis.document.activeElement?.textContent?.trim());
      assert.equal(activeHref, "#main-content", `First Tab must focus skip link with href="#main-content", got ${activeHref}`);
      assert.ok(activeText?.includes("Bỏ qua tới nội dung chính"), `Skip link text mismatch: ${activeText}`);

      // Press Enter to follow skip link
      await maintPage.keyboard.press("Enter");

      const focusedTarget = await maintPage.evaluate(() => {
        const el = globalThis.document.activeElement;
        if (!el) return null;
        if (el.id === "main-content") return "main-content";
        if (el.closest("#main-content")) return "inside-main-content";
        return el.tagName.toLowerCase();
      });
      assert.ok(
        focusedTarget === "main-content" || focusedTarget === "inside-main-content",
        `Focus should be on #main-content after Enter on skip link, got ${focusedTarget}`,
      );
    });

    await step("keyboard navigation through sidebar links with Enter and aria-current='page' (AC-3)", async () => {
      await maintPage.goto(`${BASE}/dashboard`);
      await maintPage.getByRole("heading", { name: /Tổng quan/ }).waitFor();

      // Tab through elements until reaching 'Dự án' link
      let found = false;
      for (let i = 0; i < 20; i++) {
        await maintPage.keyboard.press("Tab");
        const activeText = await maintPage.evaluate(() => globalThis.document.activeElement?.textContent?.trim());
        if (activeText === "Dự án") {
          found = true;
          break;
        }
      }
      assert.ok(found, "Should be able to Tab to 'Dự án' link");

      // Press Enter to navigate
      await maintPage.keyboard.press("Enter");
      await maintPage.waitForURL(/\/projects/);
      await maintPage.getByRole("heading", { name: /Dự án/ }).waitFor();

      const ariaCurrent = await maintPage.evaluate(() => {
        const nav = globalThis.document.querySelector('nav[aria-label="Điều hướng chính"]');
        const link = Array.from(nav?.querySelectorAll("a") ?? []).find((a) => a.textContent.trim() === "Dự án");
        return link?.getAttribute("aria-current");
      });
      assert.equal(ariaCurrent, "page", "'Dự án' link must have aria-current='page'");
    });

    await step("form controls on /projects, /agents, /provider-accounts, /workers, /members have accessible names (AC-4)", async () => {
      const routes = ["/projects", "/agents", "/provider-accounts", "/workers", "/members"];
      for (const r of routes) {
        await adminPage.goto(`${BASE}${r}`);
        await adminPage.locator("h1").waitFor();

        const missing = await adminPage.evaluate(() => {
          const controls = Array.from(globalThis.document.querySelectorAll('input:not([type="hidden"]), select, textarea'));
          const unlabelled = [];
          for (const el of controls) {
            // Ignore hidden elements
            if (el.offsetParent === null && el.type !== "file") continue;
            const hasLabel = el.labels && el.labels.length > 0 && Array.from(el.labels).some((l) => l.textContent.trim().length > 0);
            const hasAriaLabel = Boolean(el.getAttribute("aria-label")?.trim());
            const ariaLabelledBy = el.getAttribute("aria-labelledby");
            const hasAriaLabelledBy = Boolean(ariaLabelledBy && globalThis.document.getElementById(ariaLabelledBy)?.textContent?.trim());
            if (!hasLabel && !hasAriaLabel && !hasAriaLabelledBy) {
              unlabelled.push({ tag: el.tagName, name: el.getAttribute("name"), outerHTML: el.outerHTML });
            }
          }
          return unlabelled;
        });

        assert.equal(missing.length, 0, `Controls without accessible names on ${r}: ${JSON.stringify(missing)}`);
      }
    });

    await step("every tested page has exactly 1 h1 and html[lang='vi'] (AC-4)", async () => {
      const testPages = ["/dashboard", "/projects", "/agents", "/provider-accounts", "/workers", "/members", "/profile"];
      for (const p of testPages) {
        await adminPage.goto(`${BASE}${p}`);
        await adminPage.locator("h1").waitFor();

        const lang = await adminPage.evaluate(() => globalThis.document.documentElement.getAttribute("lang"));
        assert.equal(lang, "vi", `html lang must be 'vi' on ${p}`);

        const h1Count = await adminPage.locator("h1").count();
        assert.equal(h1Count, 1, `Expected exactly 1 h1 on ${p}, found ${h1Count}`);
      }
    });

    await step("unauthenticated user opening /profile is redirected to /login (AC-5)", async () => {
      const anonCtx = await browser.newContext();
      const anonPage = await anonCtx.newPage();

      await anonPage.goto(`${BASE}/profile`);
      await anonPage.waitForURL(/\/login/);
      await anonPage.getByRole("heading", { name: /AI Dev Team Control Center/ }).waitFor();

      const lang = await anonPage.evaluate(() => globalThis.document.documentElement.getAttribute("lang"));
      assert.equal(lang, "vi", "html lang must be 'vi' on /login");
      const h1Count = await anonPage.locator("h1").count();
      assert.equal(h1Count, 1, "Expected exactly 1 h1 on /login");
    });
  } finally {
    await browser.close();
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`---\npassed=${results.length - failed} failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
