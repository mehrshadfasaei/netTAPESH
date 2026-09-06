// @ts-check
const { defineConfig, devices } = require("@playwright/test");

// Boots the real FastAPI app (backend/main.py serves both the API and the
// static frontend from one process — see its bottom-of-file StaticFiles
// mount) against a throwaway sqlite file, so these tests exercise the
// actual served frontend/js/speedtest.js against the actual backend, not
// a mock.
module.exports = defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8765",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765",
    url: "http://127.0.0.1:8765/health",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      NETPULSE_DATABASE_URL: "sqlite:///./data/e2e-test.db",
      NETPULSE_DEBUG: "false",
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Use the browser binary already present in this environment
        // instead of the one matching whatever @playwright/test version
        // npm happens to resolve — avoids re-downloading a browser on
        // every fresh install/CI run.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {},
      },
    },
  ],
});
