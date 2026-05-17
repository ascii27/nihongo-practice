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

test("grammar skill: generate → review one card → queue advances", async ({ page }) => {
  await login(page);

  const grammarCard = page.locator(".skill-card--grammar");
  await expect(grammarCard).toBeVisible();
  await grammarCard.getByRole("button", { name: /Generate/i }).click();

  // After generate, the grammar card's count flips to 3 (fake AI fixture has 3 grammar items)
  await expect(grammarCard.locator(".skill-card__count")).toContainText("3", { timeout: 10_000 });

  // Tap "Practice →" on the grammar card
  await grammarCard.getByRole("button", { name: /Practice/i }).click();
  // Pattern chip should render on the prompt face
  await expect(page.locator(".flipcard__chip")).toBeVisible();
  await page.getByRole("button", { name: /tap to reveal/i }).click();
  // Answer face: explanation visible
  await expect(page.locator(".flipcard__explanation")).toBeVisible();
  await page.getByRole("button", { name: /got it/i }).click();
  await expect(page.locator(".practice__progress, h1:has-text('Done')")).toBeVisible();
});
