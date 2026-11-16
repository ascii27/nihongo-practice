import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login, expectSkillCount, generateCards, practiceSkill } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

test("conjugation: generate → type answer → auto-grade + advance", async ({ page }) => {
  await login(page);
  await generateCards(page, "conjugation");
  // CONJUGATION_FAKE has 3 items.
  await expectSkillCount(page, "conjugation", 3);

  await practiceSkill(page, "conjugation");
  // First fixture item: { base: 食べる, tense: past polite, expected: 食べました }
  const input = page.locator(".typed-card__input");
  await expect(input).toBeVisible();

  await input.fill("食べました");
  await page.getByRole("button", { name: /Submit/i }).click();

  await expect(page.locator(".typed-card__feedback.is-correct")).toBeVisible();
  await page.getByRole("button", { name: /Got it/i }).click();
  // Next card prompt, in-session counter, or summary — all valid post-grade states.
  await expect(page.locator(".practice-bar__count, .summary__title, .typed-card__base").first()).toBeVisible();
});
