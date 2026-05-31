import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login, generateViaSettings, practiceSkill, POST_GRADE } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

test("particle skill: generate → answer one MC card", async ({ page }) => {
  await login(page);
  await generateViaSettings(page, "particle");
  await expect(page.locator(".skill-card--particle .today__skill-num")).toContainText("3", { timeout: 10_000 });

  await practiceSkill(page, "particle");
  // Four option buttons rendered.
  await expect(page.locator(".mc-option")).toHaveCount(4);
  // Tap the first option — whatever the result, feedback appears.
  await page.locator(".mc-option").first().click();
  await expect(page.locator(".mc-card__feedback")).toBeVisible();
  await page.getByRole("button", { name: /Next/i }).click();
  await expect(page.locator(POST_GRADE).first()).toBeVisible();
});
