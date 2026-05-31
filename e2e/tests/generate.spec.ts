import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login, generateViaSettings } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

test("empty dashboard → generate vocab in Settings → cards appear on Today", async ({ page }) => {
  await login(page);
  // Empty state visible on the hero / skill rows.
  await expect(page.getByText(/all caught up/i).first()).toBeVisible();

  await generateViaSettings(page, "vocab");
  // Fake AI returns 5 vocab items (VOCAB_FAKE has 5 entries).
  await expect(page.locator(".today__hero-count")).toContainText("5", { timeout: 10_000 });
});

test("settings screen lists the run after generation", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.locator(".settings__select").selectOption("vocab");
  await page.getByRole("button", { name: /^Generate/i }).click();
  await expect(page.getByRole("status")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".settings__gen-item")).toHaveCount(1);
});
