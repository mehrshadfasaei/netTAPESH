// @ts-check
const { test, expect } = require("@playwright/test");

// Headless Chromium on Linux (this test's actual environment, and most
// CI runners) doesn't implement the Web Share API, so this always
// naturally exercises shareResult()'s clipboard fallback — same code
// path a desktop browser visitor would hit. The addInitScript below
// makes that explicit rather than relying on an environment quirk.
test("share button copies a result summary to the clipboard", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    // @ts-ignore — force the fallback path even on a browser/OS combo
    // that does implement navigator.share.
    delete window.navigator.share;
  });

  await page.goto("/");
  await page.locator("#runBtn").click();
  await expect(page.locator("#resultsOverlay")).toBeVisible({ timeout: 45_000 });

  const shareBtn = page.locator("#resultsShareBtn");
  await shareBtn.click();

  // Button flashes a "copied" confirmation rather than doing nothing
  // visible.
  await expect(shareBtn).toHaveClass(/copied/);

  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toContain("netTAPESH");
  expect(clipboardText).toContain(baseURL);
  // Should carry the actual numbers, not placeholder text.
  expect(clipboardText).toMatch(/\d/);
});
