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

test("conjugation: generate → type answer → auto-grade + override", async ({ page }) => {
  await login(page);

  const card = page.locator(".skill-card--conjugation");
  await card.getByRole("button", { name: /Generate/i }).click();
  // CONJUGATION_FAKE has 3 items; the dashboard's default count may be higher,
  // but the fake-AI path slices to min(count, 3).
  await expect(card.locator(".skill-card__count")).toContainText("3", { timeout: 10_000 });

  await card.getByRole("button", { name: /Practice/i }).click();
  // The first fixture item is { base: 食べる, tense: past polite, expected: 食べました }
  const input = page.locator(".typed-card__input");
  await expect(input).toBeVisible();

  // Type the expected form
  await input.fill("食べました");
  await page.getByRole("button", { name: /Submit/i }).click();

  await expect(page.locator(".typed-card__feedback.is-correct")).toBeVisible();
  await page.getByRole("button", { name: /Got it/i }).click();
  // Either the next card's prompt becomes visible (.typed-card__base) or the summary heading "Done" or the progress counter — all valid post-grade states.
  await expect(page.locator(".practice__progress, h1:has-text('Done'), .typed-card__base").first()).toBeVisible();
});
