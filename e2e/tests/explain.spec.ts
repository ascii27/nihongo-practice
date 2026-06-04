import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login, generateViaSettings, practiceSkill } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

test("explain: generate → write → AI grade → confirm + advance", async ({ page }) => {
  await login(page);
  await generateViaSettings(page, "explain");
  // EXPLAIN_FAKE has 2 items.
  await expect(page.locator(".skill-card--explain .today__skill-num")).toContainText("2", { timeout: 10_000 });

  await practiceSkill(page, "explain");

  const input = page.locator(".production-card__input");
  await expect(input).toBeVisible();
  await input.fill("結論として、移行しました。その結果、性能が向上しました。一方で、コストは増えました。");
  await page.getByRole("button", { name: /Submit for grading/i }).click();

  // Graded view: overall score + corrected version + grade bar.
  await expect(page.locator(".production-card__overall")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".production-card__corrected")).toBeVisible();

  await page.getByRole("button", { name: /Got it/i }).click();
  // Next card prompt, in-session counter, or summary — all valid post-grade states.
  await expect(
    page.locator(".practice-bar__count, .summary__title, .production-card__task").first(),
  ).toBeVisible();
});
