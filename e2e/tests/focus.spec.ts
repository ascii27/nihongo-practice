import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-tags");
});

test("focus: skill × tag narrows the hero and starts a focused session", async ({ page }) => {
  await login(page);
  await page.getByLabel("Skill").selectOption({ label: "Kanji" });
  await page.getByLabel("Tag").selectOption({ label: "Coto Academy (2)" });
  await expect(page.getByText("cards · Kanji × Coto Academy")).toBeVisible();
  await expect(page.locator(".today__hero-count")).toHaveText("1");
  await page.getByRole("button", { name: "Start focused practice" }).click();
  await expect(page.locator(".practice-bar")).toBeVisible();
});

test("focus: empty focus offers drill, and drilling leaves the box unchanged", async ({ page }) => {
  await login(page);
  // Vocab × Coto Academy is one card (水). Introduce it through a focused session.
  await page.getByLabel("Skill").selectOption({ label: "Vocab" });
  await page.getByLabel("Tag").selectOption({ label: "Coto Academy (2)" });
  await page.getByRole("button", { name: "Start focused practice" }).click();
  await page.getByRole("button", { name: /Tap to reveal/i }).click();
  await page.getByRole("button", { name: /Got it/i }).click();
  await page.getByRole("button", { name: "Back to Today" }).click();

  // Nothing left in the focus → drill fallback.
  await expect(page.getByText("Nothing due in Vocab × Coto Academy.")).toBeVisible();
  await page.getByRole("button", { name: "Drill all 1 anyway" }).click();
  await page.getByRole("button", { name: /Tap to reveal/i }).click();
  await page.getByRole("button", { name: /Got it/i }).click();
  await page.getByRole("button", { name: "Back to Today" }).click();

  // The drill did not touch the schedule: still box 1 after exactly one review.
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByLabel("Search library").fill("water");
  await page.locator(".study-item__open").first().click();
  await expect(page.getByRole("dialog", { name: "Card detail" }).getByText(/Box 1 of 5 · 1 review ·/)).toBeVisible();
});

test("focus: tapping a skill row sets the focus, which survives a reload", async ({ page }) => {
  await login(page);
  await page.locator(".skill-card--vocab").click();
  await expect(page.getByRole("button", { name: "Clear focus Vocab" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Clear focus Vocab" })).toBeVisible();
  await page.getByRole("button", { name: "Clear focus Vocab" }).click();
  await expect(page.getByText(/cards across all skills/)).toBeVisible();
});

test("focus: a remembered tag that was deleted falls back to no focus", async ({ page }) => {
  await login(page);
  await page.getByLabel("Tag").selectOption({ label: "Coto Academy (2)" });
  await expect(page.getByRole("button", { name: "Clear focus Coto Academy" })).toBeVisible();
  loadFixture("seed-test-items");          // wipes every tag
  await page.reload();
  await expect(page.getByText(/cards across all skills/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Clear focus/ })).toHaveCount(0);
});
