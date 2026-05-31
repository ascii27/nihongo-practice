import { expect, type Page } from "@playwright/test";

export const PASSCODE = process.env.E2E_PASSCODE ?? "test";

export async function login(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Passcode").fill(PASSCODE);
  await page.getByRole("button", { name: /enter/i }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

// Card generation lives in Settings (the redesigned Today screen only
// navigates into practice). Generate cards for `skill`, then return to Today.
// Fake-AI fixtures cap the actual inserted count regardless of the request.
export async function generateViaSettings(page: Page, skill: string): Promise<void> {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.locator(".settings__select").selectOption(skill);
  await page.getByRole("button", { name: /^Generate/i }).click();
  await expect(page.getByRole("status")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Back to Today/i }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

// Start a single-skill session by tapping that skill's row on Today. The rows
// retain `.skill-card--<skill>` so this stays a stable hook.
export async function practiceSkill(page: Page, skill: string): Promise<void> {
  await page.locator(`.skill-card--${skill}`).click();
}

// Any valid post-grade state: the next card, the in-session counter, or the
// end-of-session summary.
export const POST_GRADE = ".practice-bar__count, .summary__title";
