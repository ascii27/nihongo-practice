import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

test("create a grammar lesson (auto) and walk it to completion", async ({ page }) => {
  await login(page);

  // Open the Lessons tab.
  await page.getByRole("button", { name: /^Lessons$/ }).click();
  await expect(page.getByRole("heading", { name: "Lessons" })).toBeVisible();

  // Auto mode ("Choose for me") is the default: enter a theme + create.
  await page.getByPlaceholder(/giving advice/i).fill("at the cafe");
  await page.getByRole("button", { name: /Create lesson/i }).click();

  // The new lesson row is disabled while generating; wait for it to become
  // enabled (status → ready under fake AI), then open it.
  const openBtn = page.locator(".lessons__item-btn").first();
  await expect(openBtn).toBeEnabled({ timeout: 45_000 });
  await openBtn.click();

  // The first block is grammar teaching — a step-by-step explanation.
  await expect(page.locator(".teach__heading").first()).toBeVisible({ timeout: 15_000 });

  // Walk every block: grammar (Continue) → vocab (Start review + flip) →
  // reading (Show answer + Continue) → listening/quiz/cloze (MCQ) → complete.
  for (let i = 0; i < 80; i++) {
    if (await page.getByText(/Lesson complete/i).isVisible().catch(() => false)) break;

    // Teach-page advance affordances.
    const startReview = page.getByRole("button", { name: /Start review/i });
    if (await startReview.isVisible().catch(() => false)) { await startReview.click(); continue; }
    const showAnswer = page.getByRole("button", { name: /Show answer/i });
    if (await showAnswer.isVisible().catch(() => false)) { await showAnswer.click(); continue; }

    // Multiple-choice (quiz / cloze / listening): pick an option.
    const opt = page.locator(".mc-option").first();
    if (await opt.isVisible().catch(() => false)) { await opt.click(); }

    // Any advance/grade affordance across teach / MC / flip / listening / quiz states.
    const advance = page.getByRole("button", {
      name: /Continue|Next|Finish|Score|Got it|Reveal|Show|Again|Hard|Good|Easy/i,
    }).first();
    if (await advance.isVisible().catch(() => false)) { await advance.click(); }

    await page.waitForTimeout(150);
  }

  await expect(page.getByText(/Lesson complete/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Back to Today/i }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
});
