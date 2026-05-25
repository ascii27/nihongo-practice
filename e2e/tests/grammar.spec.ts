import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login, generateViaSettings, practiceSkill, POST_GRADE } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

test("grammar skill: generate → review one card → queue advances", async ({ page }) => {
  await login(page);
  await generateViaSettings(page, "grammar");

  // Fake AI inserts 3 grammar items → the Today row total reads 3.
  await expect(page.locator(".skill-card--grammar .today__skill-num")).toContainText("3", { timeout: 10_000 });

  await practiceSkill(page, "grammar");
  // Pattern renders on the prompt face.
  await expect(page.locator(".flipcard__pattern")).toBeVisible();
  await page.getByRole("button", { name: /tap to reveal/i }).click();
  await expect(page.locator(".flipcard__explanation")).toBeVisible();
  await page.getByRole("button", { name: /got it/i }).click();
  await expect(page.locator(POST_GRADE).first()).toBeVisible();
});
