import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login, expectSkillCount, generateCards, practiceSkill, POST_GRADE } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

test("reading: generate → reveal answer → grade", async ({ page }) => {
  await login(page);
  await generateCards(page, "reading");
  // READING_FAKE has 2 items.
  await expectSkillCount(page, "reading", 2);

  await practiceSkill(page, "reading");
  await expect(page.locator(".flipcard__sentence.is-passage")).toBeVisible();
  await expect(page.locator(".flipcard__question")).toBeVisible();

  await page.getByRole("button", { name: /tap to reveal/i }).click();
  await expect(page.locator(".flipcard__answer-en")).toBeVisible();

  await page.getByRole("button", { name: /got it/i }).click();
  await expect(page.locator(POST_GRADE).first()).toBeVisible();
});
