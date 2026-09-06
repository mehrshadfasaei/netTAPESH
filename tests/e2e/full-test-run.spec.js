// @ts-check
const { test, expect } = require("@playwright/test");

// Runs a real end-to-end speed test against the actual backend (download
// + upload streams, real timing) — the same class of run used to catch
// the "upload shows 0" bug earlier in this project. The test itself runs
// for TEST_DURATION_MS (8s, see frontend/js/speedtest.js) per phase, so
// this is deliberately slow; that's the price of testing the real thing
// instead of a mock.
test("running a full speed test shows non-zero results", async ({ page }) => {
  await page.goto("/");
  await page.locator("#runBtn").click();

  const resultsOverlay = page.locator("#resultsOverlay");
  await expect(resultsOverlay).toBeVisible({ timeout: 45_000 });

  const download = await page.locator("#resDown").innerText();
  const upload = await page.locator("#resUp").innerText();
  const ping = await page.locator("#resPing").innerText();

  expect(parseFloat(download)).toBeGreaterThan(0);
  expect(parseFloat(upload)).toBeGreaterThan(0);
  expect(parseFloat(ping)).toBeGreaterThan(0);
});

test("closing the results overlay returns to the normal page", async ({ page }) => {
  await page.goto("/");
  await page.locator("#runBtn").click();
  await expect(page.locator("#resultsOverlay")).toBeVisible({ timeout: 45_000 });

  await page.locator("#resultsCloseBtn").click();
  await expect(page.locator("#resultsOverlay")).toBeHidden();
  // Header/nav/main/footer are hidden while the overlay is open (see
  // openResultsOverlay/closeResultsOverlay in speedtest.js) — confirm
  // they're back once it's closed.
  await expect(page.locator("#pageHeader")).toBeVisible();
  await expect(page.locator("#pageMain")).toBeVisible();
});
