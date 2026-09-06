// @ts-check
const { test, expect } = require("@playwright/test");

// FAQ items are native <details>/<summary> (see index.html's comment on
// why — zero-JS accordion, fully indexable collapsed by Google). Verify
// the actual browser-native open/close behavior works as expected.
test("FAQ items are collapsed by default and expand on click", async ({ page }) => {
  await page.goto("/");

  const items = page.locator(".faq-item");
  const count = await items.count();
  expect(count).toBeGreaterThan(0);

  const first = items.first();
  await expect(first).not.toHaveAttribute("open", "");

  await first.locator("summary").click();
  await expect(first).toHaveAttribute("open", "");

  // Its answer paragraph should now actually be visible, not just have
  // the `open` attribute set.
  await expect(first.locator("p")).toBeVisible();
});

test("each FAQ item toggles independently", async ({ page }) => {
  await page.goto("/");

  const items = page.locator(".faq-item");
  const first = items.nth(0);
  const second = items.nth(1);

  await first.locator("summary").click();
  await expect(first).toHaveAttribute("open", "");
  await expect(second).not.toHaveAttribute("open", "");

  await second.locator("summary").click();
  await expect(second).toHaveAttribute("open", "");
  // Native <details> elements are independent unless given a shared
  // `name` attribute — the first should stay open.
  await expect(first).toHaveAttribute("open", "");
});
