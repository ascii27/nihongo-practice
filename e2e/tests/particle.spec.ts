import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";

const PASSCODE = process.env.E2E_PASSCODE ?? "test";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Passcode").fill(PASSCODE);
  await page.getByRole("button", { name: /enter/i }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

test("particle skill: generate → answer one MC card", async ({ page }) => {
  await login(page);

  const card = page.locator(".skill-card--particle");
  await card.getByRole("button", { name: /Generate/i }).click();
  await expect(card.locator(".skill-card__count")).toContainText("3", { timeout: 10_000 });

  await card.getByRole("button", { name: /Practice/i }).click();
  // Four option buttons rendered
  await expect(page.locator(".mc-option")).toHaveCount(4);
  // Tap the first option — whatever the result, feedback appears
  await page.locator(".mc-option").first().click();
  await expect(page.locator(".mc-card__feedback")).toBeVisible();
  await page.getByRole("button", { name: /Next/i }).click();
  await expect(page.locator(".practice__progress, h1:has-text('Done')")).toBeVisible();
});
