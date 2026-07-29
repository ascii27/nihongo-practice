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
