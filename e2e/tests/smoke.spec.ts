import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login, POST_GRADE } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-items");
});

test("passcode → Dashboard shows fixture cards across skills", async ({ page }) => {
  await login(page);
  // 3 vocab seed items → hero "ready to review" count = 3
  await expect(page.locator(".today__hero-count")).toContainText("3");
});

test("wrong passcode shows an error", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Passcode").fill("definitely-wrong");
  await page.getByRole("button", { name: /enter/i }).click();
  await expect(page.getByRole("alert")).toHaveText(/wrong passcode/i);
});

test("mixed practice review advances queue", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: /Start mixed practice/i }).click();
  await page.getByRole("button", { name: /tap to reveal/i }).click();
  await page.getByRole("button", { name: /got it/i }).click();
  await expect(page.locator(POST_GRADE).first()).toBeVisible();
});

test("daily review target stepper clamps at its minimum", async ({ page }) => {
  await login(page);

  // Drive the target down to its 10 minimum so the fixture deck can meet it.
  await page.goto("/");
  await page.getByRole("button", { name: /settings/i }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: /decrease daily review target/i }).click();
  }
  await expect(page.locator(".settings__stepper-value")).toHaveText("10");
});
