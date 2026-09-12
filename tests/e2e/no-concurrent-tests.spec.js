// @ts-check
const { test, expect } = require("@playwright/test");

// Both the main speed test and the continuous-ping loop hit the same
// /download and /upload endpoints — running them at once would have
// each silently steal the other's bandwidth and corrupt both sets of
// numbers rather than erroring. See setMainTestRunning() in
// speedtest.js: the continuous-ping start button is disabled with an
// explanatory hint for as long as the main test is running.
test("continuous-ping start button is disabled while the main test runs, and works again once it finishes", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#runBtn").click();

  // Switch tabs WHILE the main test is still running (nothing blocks
  // tab switching mid-test — only starting a second, conflicting test).
  await page.locator('[data-tab="continuousPing"]').click();

  const toggleBtn = page.locator("#pingLoopToggleBtn");
  const hint = page.locator("#pingLoopBlockedHint");
  await expect(toggleBtn).toBeDisabled();
  await expect(hint).toBeVisible();

  await expect(page.locator("#resultsOverlay")).toBeVisible({ timeout: 45_000 });
  await page.locator("#resultsCloseBtn").click();
  await page.locator('[data-tab="continuousPing"]').click();

  await expect(toggleBtn).toBeEnabled();
  await expect(hint).toBeHidden();

  await toggleBtn.click();
  await expect(toggleBtn).toHaveClass(/running/);
});
