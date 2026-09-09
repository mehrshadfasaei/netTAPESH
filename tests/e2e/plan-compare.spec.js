// @ts-check
const { test, expect } = require("@playwright/test");

// Optional ISP-plan-speed comparison in the results overlay — entirely
// client-side (see renderPlanCompare()/PLAN_SPEED_STORAGE_KEY in
// speedtest.js and the HTML comment on #planCompareBlock for why: no
// auth on this app's shared history table means anything sent to the
// server there is effectively public, so the plan number never leaves
// the browser).
test("prompts for a plan speed first, then shows a comparison once saved", async ({ page }) => {
  await page.goto("/");
  await page.locator("#runBtn").click();
  await expect(page.locator("#resultsOverlay")).toBeVisible({ timeout: 45_000 });

  // First run, nothing saved yet — the input prompt, not a result line.
  await expect(page.locator("#planInputForm")).toBeVisible();
  await expect(page.locator("#planResultRow")).toBeHidden();

  await page.locator("#planSpeedInput").fill("50");
  await page.locator("#planInputForm button[type=submit]").click();

  await expect(page.locator("#planResultRow")).toBeVisible();
  await expect(page.locator("#planInputForm")).toBeHidden();
  await expect(page.locator("#planResultText")).toContainText("50");
});

test("the saved plan speed persists across a new test run", async ({ page }) => {
  await page.goto("/");
  await page.locator("#runBtn").click();
  await expect(page.locator("#resultsOverlay")).toBeVisible({ timeout: 45_000 });

  await page.locator("#planSpeedInput").fill("100");
  await page.locator("#planInputForm button[type=submit]").click();
  await expect(page.locator("#planResultRow")).toBeVisible();

  await page.locator("#resultsCloseBtn").click();
  await page.locator("#runBtn").click();
  await expect(page.locator("#resultsOverlay")).toBeVisible({ timeout: 45_000 });

  // Straight to the result line on this second run — no need to
  // re-enter a plan speed already saved.
  await expect(page.locator("#planResultRow")).toBeVisible();
  await expect(page.locator("#planInputForm")).toBeHidden();
  await expect(page.locator("#planResultText")).toContainText("100");
});

test("the edit button pre-fills the input with the current saved value", async ({ page }) => {
  await page.goto("/");
  await page.locator("#runBtn").click();
  await expect(page.locator("#resultsOverlay")).toBeVisible({ timeout: 45_000 });

  await page.locator("#planSpeedInput").fill("30");
  await page.locator("#planInputForm button[type=submit]").click();
  await expect(page.locator("#planResultRow")).toBeVisible();

  await page.locator("#planEditBtn").click();
  await expect(page.locator("#planInputForm")).toBeVisible();
  await expect(page.locator("#planResultRow")).toBeHidden();
  await expect(page.locator("#planSpeedInput")).toHaveValue("30");
});

test("the saved plan speed is never sent to the server", async ({ page }) => {
  // Pre-seed a distinctive plan speed BEFORE the page (and its own
  // save flow) runs at all — this is what actually makes the
  // assertion below meaningful. If it were entered fresh through the
  // form mid-test, the /result POST fired by that same test run would
  // trivially predate it and pass either way.
  const DISTINCTIVE_PLAN_SPEED = "918273";
  await page.addInitScript((value) => {
    localStorage.setItem("nettapesh_plan_mbps", value);
  }, DISTINCTIVE_PLAN_SPEED);

  const requestBodies = [];
  page.on("request", (req) => {
    if (req.method() === "POST") requestBodies.push(req.postData() || "");
  });

  await page.goto("/");
  await page.locator("#runBtn").click();
  await expect(page.locator("#resultsOverlay")).toBeVisible({ timeout: 45_000 });

  // Comparison should already show (plan speed was pre-seeded), no
  // input step needed.
  await expect(page.locator("#planResultRow")).toBeVisible();
  await expect(page.locator("#planResultText")).toContainText(DISTINCTIVE_PLAN_SPEED);

  expect(requestBodies.length).toBeGreaterThan(0);
  for (const body of requestBodies) {
    expect(body).not.toContain(DISTINCTIVE_PLAN_SPEED);
  }
});
