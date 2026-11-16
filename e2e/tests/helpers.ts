import { expect, type Page } from "@playwright/test";

export const PASSCODE = process.env.E2E_PASSCODE ?? "test";

export async function login(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Passcode").fill(PASSCODE);
  await page.getByRole("button", { name: /enter/i }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

// Card generation lives in Library (ASC-26): the "+ Generate" chip opens a
// sheet. Generate cards for `skill`, wait for the result, and close the sheet;
// the page stays on Library.
// Fake-AI fixtures cap the actual inserted count regardless of the request.
export async function generateCards(page: Page, skill: string): Promise<void> {
  await openLibrary(page);
  await page.getByRole("button", { name: "+ Generate" }).click();
  const sheet = page.getByRole("dialog", { name: "Generate cards" });
  await sheet.getByLabel("Card type").selectOption(skill);
  await sheet.getByRole("button", { name: /^Generate \d/ }).click();
  await expect(sheet.getByRole("status")).toBeVisible({ timeout: 15_000 });
  await sheet.getByRole("button", { name: "Close generate cards" }).click();
}

export async function openLibrary(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
}

// The per-skill counts moved from Today to Library's skill chips. Each chip
// keeps `.skill-card--<skill>` as a stable hook. Leaves the page on Library.
export async function expectSkillCount(page: Page, skill: string, n: number): Promise<void> {
  await openLibrary(page);
  await expect(page.locator(`.skill-card--${skill} .skill-chip__num`)).toHaveText(`· ${n}`, { timeout: 10_000 });
}

// Open the skill in Library, hand off to Today with "Study this skill", then
// start that focused (budgeted) session.
export async function practiceSkill(page: Page, skill: string): Promise<void> {
  await openLibrary(page);
  await page.locator(`.skill-card--${skill}`).click();
  await page.getByRole("button", { name: "Study this skill" }).click();
  await page.getByRole("button", { name: /Start focused practice/ }).click();
}

// Any valid post-grade state: the next card, the in-session counter, or the
// end-of-session summary.
export const POST_GRADE = ".practice-bar__count, .summary__title";
