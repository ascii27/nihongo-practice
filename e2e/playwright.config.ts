import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  // Single worker: specs share one Postgres and each beforeEach loads a
  // fixture, so parallel workers would race on conflicting DB state.
  workers: 1,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "iphone-14", use: { ...devices["iPhone 14"] } },
  ],
});
