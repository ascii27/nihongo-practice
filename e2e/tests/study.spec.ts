import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login, POST_GRADE } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-study");
});

test("study: create list → quick-add + search-add → cram → grade", async ({ page }) => {
  await login(page);

  // Open the Study tab and create a list (navigates into the detail screen).
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await page.getByPlaceholder("e.g. Class Week 5").fill("Class Week 5");
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByRole("heading", { name: "Class Week 5" })).toBeVisible();

  // Quick-add a new vocab card.
  await page.getByRole("tab", { name: /Quick-add new/ }).click();
  await page.getByPlaceholder(/Japanese/).fill("学校");
  await page.getByPlaceholder(/English/).fill("school");
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.locator(".study-item__front", { hasText: "学校" })).toBeVisible();

  // Search an existing card and add it.
  await page.getByRole("tab", { name: /Search & add/ }).click();
  await page.getByPlaceholder("Search your cards…").fill("water");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(page.locator(".study-item__front", { hasText: "水" })).toBeVisible();

  // Cram the whole list, then grade a card.
  await page.getByRole("button", { name: /Study now/ }).click();
  await expect(page.locator(".practice-bar")).toBeVisible();
  // Reveal + grade the first card.
  await page.getByRole("button", { name: /Tap to reveal/i }).click();
  await page.getByRole("button", { name: /Got it/i }).click();
  await expect(page.locator(POST_GRADE).first()).toBeVisible();
});
