// @ts-check
const { test, expect } = require("@playwright/test");

// History charts got a ping overlay (a line on its own right-hand ms
// axis, drawn over the download/upload Mbps bars) plus formatted
// tooltip text — see makeHistoryBarChart()/loadHistory() in
// speedtest.js. This checks the actual chart data/config the library
// ends up with, rather than trying to assert on rendered pixels.
test("history chart plots a ping line alongside the download bars", async ({ page }) => {
  await page.goto("/");
  await page.locator("#runBtn").click();
  await expect(page.locator("#resultsOverlay")).toBeVisible({ timeout: 45_000 });
  await page.locator("#resultsCloseBtn").click();
  await expect(page.locator("#historyChartDownBlock")).toBeVisible();

  const datasets = await page.evaluate(() => {
    // @ts-ignore — Chart is the vendored chart.umd.js global.
    const chart = Chart.getChart("historyChartDown");
    return chart.data.datasets.map((d) => ({
      type: d.type,
      yAxisID: d.yAxisID,
      pointCount: d.data.length,
    }));
  });

  // pointCount isn't asserted as exactly 1 — this test's throwaway DB
  // is shared with whichever other spec files happen to run in the
  // same worker process, so more than one result can already be in
  // history by the time this runs. What matters here is the chart
  // shape (a bar dataset plus a ping line on its own axis, kept in
  // sync with each other), not the exact row count.
  expect(datasets).toHaveLength(2);
  expect(datasets[0].type).toBe("bar");
  expect(datasets[1]).toMatchObject({ type: "line", yAxisID: "yPing" });
  expect(datasets[0].pointCount).toBeGreaterThan(0);
  expect(datasets[1].pointCount).toBe(datasets[0].pointCount);
});

test("tooltip callback formats bar and ping values with units", async ({ page }) => {
  await page.goto("/");
  await page.locator("#runBtn").click();
  await expect(page.locator("#resultsOverlay")).toBeVisible({ timeout: 45_000 });
  await page.locator("#resultsCloseBtn").click();
  await expect(page.locator("#historyChartDownBlock")).toBeVisible();

  const { barLabel, pingLabel } = await page.evaluate(() => {
    // @ts-ignore
    const chart = Chart.getChart("historyChartDown");
    const labelCb = chart.options.plugins.tooltip.callbacks.label;
    const bar = chart.data.datasets[0];
    const ping = chart.data.datasets[1];
    return {
      barLabel: labelCb({ dataset: bar, parsed: { y: bar.data[0] } }),
      pingLabel: labelCb({ dataset: ping, parsed: { y: ping.data[0] } }),
    };
  });

  expect(barLabel).toMatch(/^دانلود: \d+(\.\d)? Mbps$/);
  expect(pingLabel).toMatch(/^پینگ: \d+(\.\d)? ms$/);
});

test("ping toggle checkbox hides and shows the ping line", async ({ page }) => {
  await page.goto("/");
  await page.locator("#runBtn").click();
  await expect(page.locator("#resultsOverlay")).toBeVisible({ timeout: 45_000 });
  await page.locator("#resultsCloseBtn").click();
  await expect(page.locator("#historyChartDownBlock")).toBeVisible();

  const isPingVisible = () =>
    page.evaluate(() => {
      // @ts-ignore
      return Chart.getChart("historyChartDown").isDatasetVisible(1);
    });

  await expect.poll(isPingVisible).toBe(true);

  await page.locator("#historyChartDownPingToggle").uncheck();
  await expect.poll(isPingVisible).toBe(false);

  await page.locator("#historyChartDownPingToggle").check();
  await expect.poll(isPingVisible).toBe(true);
});
