import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login, practiceSkill, POST_GRADE } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-kanji");
});

test("kanji: recognize flip, draw stroke order, then self-grade", async ({ page }) => {
  await login(page);

  // The seeded kanji shows as a new card on Today.
  await expect(page.locator(".skill-card--kanji .today__skill-num")).toContainText("1", { timeout: 10_000 });
  await practiceSkill(page, "kanji");

  // Recognize face: glyph up front, flip reveals meaning + stroke count.
  await expect(page.locator(".kanji-card__glyph")).toHaveText("食");
  await page.getByRole("button", { name: /Tap to reveal/i }).click();
  await expect(page.getByText("eat, food")).toBeVisible();
  await expect(page.getByText("3 strokes")).toBeVisible();

  // Draw mode: the tracing surface + stroke-order animation.
  await page.getByRole("tab", { name: "Draw" }).click();
  await expect(page.locator(".kanji-draw__surface")).toBeVisible();
  await expect(page.locator(".kanji-draw__reference")).toBeVisible();
  await page.getByRole("button", { name: "Show order" }).click();
  await expect(page.locator(".kanji-draw__anim")).toBeVisible();

  // Self-grade advances the session (next card, counter, or summary).
  await page.getByRole("button", { name: /Got it/i }).click();
  await expect(page.locator(POST_GRADE).first()).toBeVisible();
});

test("kanji: the mnemonic tab writes and shows a memory aid", async ({ page }) => {
  await login(page);
  await practiceSkill(page, "kanji");

  await page.getByRole("tab", { name: "Mnemonic" }).click();

  // Meaning scene + the replay hook.
  await expect(page.locator(".kanji-mnemonic__gloss")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".kanji-mnemonic__hook")).toBeVisible();

  // Per-reading: sound hook and a ruby-annotated example sentence.
  await expect(page.locator(".kanji-mnemonic__sound").first()).toBeVisible();
  await expect(page.locator(".kanji-mnemonic__jp ruby").first()).toBeVisible();
  await expect(page.locator(".kanji-mnemonic__en").first()).toBeVisible();

  // Swiping must not grade from this tab: drag well past the grade
  // threshold (right = "got it") and confirm the mnemonic panel is still
  // mounted and the session did not advance. The fixture seeds exactly one
  // kanji item, so a real grade would jump straight to the summary screen.
  const card = page.locator(".swipe-card");
  const box = await card.boundingBox();
  if (!box) throw new Error("swipe card not found");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(startX + i * 25, startY);
  }
  await page.mouse.up();

  // SwipeDeck's exit animation (and the onSwipe it fires) is delayed 220ms;
  // wait past that before asserting nothing changed, or a real grade could
  // still be in flight when we check.
  await page.waitForTimeout(400);

  await expect(page.locator(".kanji-mnemonic")).toBeVisible();
  await expect(page.locator(".summary__title")).toHaveCount(0);

  // Back to Recognize, and normal grading still works.
  await page.getByRole("tab", { name: "Recognize" }).click();
  await page.getByRole("button", { name: /Tap to reveal/i }).click();
  await page.getByRole("button", { name: /Got it/i }).click();
  await expect(page.locator(POST_GRADE).first()).toBeVisible();
});
