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

test("reading: generate → reveal answer → grade", async ({ page }) => {
  await login(page);

  const card = page.locator(".skill-card--reading");
  await card.getByRole("button", { name: /Generate/i }).click();
  // READING_FAKE has 2 items; default count for reading is 3, slice clamps to 2.
  await expect(card.locator(".skill-card__count")).toContainText("2", { timeout: 10_000 });

  await card.getByRole("button", { name: /Practice/i }).click();
  await expect(page.locator(".flipcard__passage")).toBeVisible();
  await expect(page.locator(".flipcard__question")).toBeVisible();

  await page.getByRole("button", { name: /tap to reveal/i }).click();
  await expect(page.locator(".flipcard__answer-en")).toBeVisible();

  await page.getByRole("button", { name: /got it/i }).click();
  await expect(page.locator(".practice__progress, h1:has-text('Done')").first()).toBeVisible();
});
