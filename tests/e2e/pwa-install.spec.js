// @ts-check
const { test, expect } = require("@playwright/test");

test("page links a manifest and registers a service worker", async ({ page }) => {
  await page.goto("/");

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBe("/manifest.json");

  // Actually wait for registration to land, not just that the API
  // exists — navigator.serviceWorker.register() is fire-and-forget in
  // speedtest.js (see its own comment on why), so nothing else forces
  // this to complete before the test would otherwise finish.
  const registration = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return null;
    const reg = await navigator.serviceWorker.ready;
    return { scope: reg.scope, hasActiveWorker: !!reg.active };
  });

  expect(registration).not.toBeNull();
  expect(registration.hasActiveWorker).toBe(true);
  expect(new URL(registration.scope).pathname).toBe("/");
});
