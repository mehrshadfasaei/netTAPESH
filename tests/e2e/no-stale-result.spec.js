// @ts-check
const { test, expect } = require("@playwright/test");

// loadLatest() was deliberately removed from speedtest.js this project
// (see git history) — the page must never auto-show a previous result on
// load, only after the visitor explicitly runs a new test themselves.
test("results overlay is not shown on page load, even after a prior test", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#runBtn").click();
  await expect(page.locator("#resultsOverlay")).toBeVisible({ timeout: 45_000 });

  await page.reload();

  await expect(page.locator("#resultsOverlay")).toBeHidden();
  await expect(page.locator("#gaugeLiveValue")).toHaveText("0.00");
});
