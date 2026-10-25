import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL,
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:18768",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1",
      url: "http://127.0.0.1:18768",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npm run party:test -- --persist-to .wrangler/e2e-${process.pid}`,
      url: "http://127.0.0.1:1999/parties/main/E2EHLT",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
