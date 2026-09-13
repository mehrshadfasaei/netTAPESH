// @ts-check
const { test, expect } = require("@playwright/test");

// A real continuous-ping round takes ~1s (ping + download probe +
// upload probe), so without a loading state the empty-state text sat
// unchanged right after clicking Start — looked like the click hadn't
// registered. See setPingLogEmptyState() in speedtest.js.
test("shows a loading state right after Start, before the first round completes", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-tab="continuousPing"]').click();

  const emptyEl = page.locator("#pingLogEmpty");
  await expect(emptyEl).toHaveText(/شروع رو بزنید/);

  await page.locator("#pingLoopToggleBtn").click();

  await expect(emptyEl).toHaveText(/در حال دریافت اولین نتیجه/);
  await expect(emptyEl).toHaveClass(/ping-log-loading/);

  // The real regression guard for this codebase's recurring
  // [hidden]-vs-class-selector specificity bug (see .btn-share,
  // .plan-input-form, ...): .ping-log-empty.ping-log-loading has
  // "display: flex", which would override [hidden]'s own "display:
  // none" without the matching [hidden] override in style.css — if
  // that regressed, this element would stay visibly stuck on top of
  // the log below instead of actually disappearing here. (Not
  // asserted as its own toBeVisible() step in between — loopback can
  // finish the first round fast enough to race that check.)
  await expect(page.locator("#pingLog")).toBeVisible({ timeout: 10_000 });
  await expect(emptyEl).toBeHidden();
});

test("stopping before the first round completes reverts to the idle prompt", async ({ page }) => {
  // Loopback is fast enough that a real round can complete between two
  // sequential clicks — delay /ping so the stop click reliably lands
  // mid-round instead of after it.
  await page.route("**/api/speedtest/ping", async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });

  await page.goto("/");
  await page.locator('[data-tab="continuousPing"]').click();
  await page.locator("#pingLoopToggleBtn").click();

  const emptyEl = page.locator("#pingLogEmpty");
  await expect(emptyEl).toHaveText(/در حال دریافت اولین نتیجه/);

  await page.locator("#pingLoopToggleBtn").click(); // stop mid-round

  await expect(emptyEl).toHaveText(/شروع رو بزنید/);
  await expect(emptyEl).not.toHaveClass(/ping-log-loading/);
});
