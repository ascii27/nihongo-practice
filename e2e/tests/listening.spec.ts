import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login, generateViaSettings, practiceSkill } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

test("listening skill: generate → answer both MC questions → session summary", async ({ page }) => {
  await login(page);
  await generateViaSettings(page, "listening");
  // LISTENING_FAKE has 1 dialogue item.
  await expect(page.locator(".skill-card--listening .today__skill-num")).toContainText("1", { timeout: 10_000 });

  await practiceSkill(page, "listening");

  // Audio element for the dialogue renders.
  await expect(page.locator("audio.listening-card__audio")).toBeVisible();

  // Question 1 of 2 — four option buttons rendered.
  await expect(page.locator(".listening-card__q")).toContainText("1/2");
  await expect(page.locator(".mc-option")).toHaveCount(4);
  await page.locator(".mc-option").first().click();
  await page.getByRole("button", { name: /Next question/i }).click();

  // Question 2 of 2.
  await expect(page.locator(".listening-card__q")).toContainText("2/2");
  await expect(page.locator(".mc-option")).toHaveCount(4);
  await page.locator(".mc-option").first().click();
  await page.getByRole("button", { name: /Finish/i }).click();

  // After "Finish →", the transcript reveal panel appears synchronously.
  await expect(page.locator(".listening-card__reveal")).toBeVisible();

  // Only one listening item was generated, so answering it ends the session.
  // Assert summary screen is actually reached, with timeout covering endSession round-trip.
  await expect(page.locator(".summary__title")).toBeVisible({ timeout: 15000 });
});
