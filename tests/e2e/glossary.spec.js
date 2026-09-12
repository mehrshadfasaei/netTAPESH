// @ts-check
const { test, expect } = require("@playwright/test");

// Short reference glossary (Ping/Jitter/Download/Upload) — see
// #glossarySection in index.html for why it's an always-visible <dl>
// rather than an accordion like the FAQ next to it.
test("glossary section shows all 4 terms and translates with the page", async ({ page }) => {
  await page.goto("/");

  const items = page.locator(".glossary-item");
  await expect(items).toHaveCount(4);
  await expect(page.locator("#glossarySection h2")).toHaveText("اصطلاحات تست سرعت");
  await expect(items.first().locator("dt")).toHaveText("پینگ (Ping)");

  await page.locator("#langSwitcherBtn").click();
  await page.locator('.lang-menu-item[data-lang="en"]').click();

  await expect(page.locator("#glossarySection h2")).toHaveText("Speed Test Glossary");
  await expect(items.first().locator("dt")).toHaveText("Ping");
  // Every term's definition should actually change too, not just the title.
  await expect(items.nth(3).locator("dd")).toContainText("uploading files");
});
