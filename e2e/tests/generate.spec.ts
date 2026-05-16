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

test("empty dashboard → per-skill Generate → vocab cards appear", async ({ page }) => {
  await login(page);

  await expect(page.getByText(/All caught up/i).first()).toBeVisible();
  // Find the Vocab skill card's Generate button and click it
  const vocabCard = page.locator(".skill-card--vocab");
  await vocabCard.getByRole("button", { name: /Generate/i }).click();

  // Wait for the dashboard to refresh; fake AI returns 5 vocab items (VOCAB_FAKE has 5 entries)
  await expect(page.locator(".dashboard__mixed-count")).toContainText("5", { timeout: 10_000 });
});

test("settings screen lists the run after generation", async ({ page }) => {
  await login(page);

  const vocabCard = page.locator(".skill-card--vocab");
  await vocabCard.getByRole("button", { name: /Generate/i }).click();
  await expect(page.locator(".dashboard__mixed-count")).toContainText("5", { timeout: 10_000 });

  await page.getByRole("button", { name: /Settings/ }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const rows = page.locator(".generations-list li");
  await expect(rows).toHaveCount(1);
});
