import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login, generateViaSettings, practiceSkill, POST_GRADE } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

test("reading: generate → reveal answer → grade", async ({ page }) => {
  await login(page);
  await generateViaSettings(page, "reading");
  // READING_FAKE has 2 items.
  await expect(page.locator(".skill-card--reading .today__skill-num")).toContainText("2", { timeout: 10_000 });

  await practiceSkill(page, "reading");
  await expect(page.locator(".flipcard__sentence.is-passage")).toBeVisible();
  await expect(page.locator(".flipcard__question")).toBeVisible();

  await page.getByRole("button", { name: /tap to reveal/i }).click();
  await expect(page.locator(".flipcard__answer-en")).toBeVisible();

  await page.getByRole("button", { name: /got it/i }).click();
  await expect(page.locator(POST_GRADE).first()).toBeVisible();
});
