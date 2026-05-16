import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";

const PASSCODE = process.env.E2E_PASSCODE ?? "test";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Passcode").fill(PASSCODE);
  await page.getByRole("button", { name: /enter/i }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

test("empty Today → compact generate form → cards appear", async ({ page }) => {
  await login(page);

  await expect(page.getByText(/All caught up/i)).toBeVisible();
  await expect(page.locator(".big-number")).toContainText("0");

  await page.locator("input[type=number]").fill("3");
  await page.getByRole("button", { name: /Generate 3 vocab/ }).click();

  await expect(page.getByRole("status")).toContainText(/Added 3/);
  await expect(page.locator(".big-number")).toContainText("3");

  await page.getByRole("button", { name: /start review/i }).click();
  await page.getByRole("button", { name: /tap to reveal/i }).click();
  await page.getByRole("button", { name: /got it/i }).click();
  await expect(page.locator(".practice__progress, h1:has-text('Done')")).toBeVisible();
});

test("settings screen lists the run after generation", async ({ page }) => {
  await login(page);

  await expect(page.getByText(/All caught up/i)).toBeVisible();
  await page.locator("input[type=number]").fill("2");
  await page.getByRole("button", { name: /Generate 2 vocab/ }).click();
  await expect(page.getByRole("status")).toContainText(/Added 2/);

  await page.getByRole("button", { name: /Settings/ }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const rows = page.locator(".generations-list li");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("2 cards");
});
