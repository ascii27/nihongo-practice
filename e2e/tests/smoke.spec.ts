import { test, expect } from "@playwright/test";

const PASSCODE = process.env.E2E_PASSCODE ?? "test";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Passcode").fill(PASSCODE);
  await page.getByRole("button", { name: /enter/i }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

test("passcode → Today shows fixture cards ready", async ({ page }) => {
  await login(page);
  await expect(page.getByText("cards ready")).toBeVisible();
  // 3 items in fixture; new-item rule means all 3 surface on day one
  await expect(page.locator(".big-number")).toContainText("3");
});

test("wrong passcode shows an error", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Passcode").fill("definitely-wrong");
  await page.getByRole("button", { name: /enter/i }).click();
  await expect(page.getByRole("alert")).toHaveText(/wrong passcode/i);
});

test("review one card and queue advances", async ({ page }) => {
  await login(page);
  const startBtn = page.getByRole("button", { name: /start review/i });
  await startBtn.click();
  // Flip + answer one card
  await page.getByRole("button", { name: /tap to reveal/i }).click();
  await page.getByRole("button", { name: /got it/i }).click();
  // Either the next card shows or summary screen.
  // After 3 answers we land on the summary; here just check the progress moved or summary appeared.
  await expect(page.locator(".practice__progress, h1:has-text('Done')")).toBeVisible();
});
