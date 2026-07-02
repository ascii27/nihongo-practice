import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

test("create a lesson, walk it to completion", async ({ page }) => {
  await login(page);

  // Open the Lessons tab.
  await page.getByRole("button", { name: /^Lessons$/ }).click();
  await expect(page.getByRole("heading", { name: "Lessons" })).toBeVisible();

  // Keep the lesson small + fast: only Vocab + Particles (both default-checked).
  for (const label of ["Grammar", "Conjugation", "Reading", "Explain", "Listening"]) {
    const cb = page.getByRole("checkbox", { name: label });
    if (await cb.isChecked().catch(() => false)) await cb.uncheck();
  }
  await page.getByPlaceholder(/giving directions/i).fill("at the cafe");
  await page.getByRole("button", { name: /Create lesson/i }).click();

  // The new lesson row is disabled while generating; wait for it to become
  // enabled (status → ready under fake AI), then open it.
  const openBtn = page.locator(".lessons__item-btn").first();
  await expect(openBtn).toBeEnabled({ timeout: 30_000 });
  await openBtn.click();

  // Walk each section: teach → check. Loop until the completion screen.
  for (let i = 0; i < 60; i++) {
    if (await page.getByText(/Lesson complete/i).isVisible().catch(() => false)) break;

    const start = page.getByRole("button", { name: /Start check/i });
    if (await start.isVisible().catch(() => false)) { await start.click(); continue; }

    // Multiple-choice (particle): pick an option, then advance.
    const opt = page.locator(".mc-option").first();
    if (await opt.isVisible().catch(() => false)) { await opt.click(); }

    // Any advance/grade affordance across FlipCard / MC / reveal states.
    const advance = page.getByRole("button", { name: /Next|Continue|Finish|Got it|Reveal|Show|Again|Hard|Good|Easy/i }).first();
    if (await advance.isVisible().catch(() => false)) { await advance.click(); }

    await page.waitForTimeout(150);
  }

  await expect(page.getByText(/Lesson complete/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Back to Today/i }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
});
