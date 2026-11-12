import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  timeout: 30_000,
  // Generate calls in CI can take a few seconds (kuromoji cold start,
  // DB transaction); bump from the 5s default.
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  // Single worker: specs share one Postgres and each beforeEach loads a
  // fixture, so parallel workers would race on conflicting DB state.
  workers: 1,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "iphone-14", use: { ...devices["iPhone 14"] }, testIgnore: /journeys\// },
    // The owner's phone. Journeys only: each step asserts the screen fits, with
    // the Home-Screen safe-area insets emulated by tests/journeys/support.ts.
    {
      name: "iphone-17",
      testMatch: /journeys\/.*\.spec\.ts/,
      use: {
        ...devices["iPhone 14"],
        viewport: { width: 402, height: 874 },
        screen: { width: 402, height: 874 },
        deviceScaleFactor: 3,
      },
    },
  ],
});
