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

  // Quick-add a new vocab card: type → generate (AI draft, editable) → add.
  await page.getByRole("tab", { name: /Quick-add new/ }).click();
  await page.getByPlaceholder(/Word/).fill("test");
  await page.getByRole("button", { name: "Generate" }).click();
  // Fake AI fills the editable draft (テスト / test + example sentence).
  await expect(page.getByRole("button", { name: "Add to list" })).toBeVisible();
  await page.getByRole("button", { name: "Add to list" }).click();
  // Members are grouped by card type, so the new card shows up as a Vocab
  // section rather than a row on this screen.
  await expect(page.getByRole("button", { name: /Vocab/ })).toBeVisible();

  // Search an existing card and add it.
  await page.getByRole("tab", { name: /Search & add/ }).click();
  await page.getByPlaceholder("Search your cards…").fill("water");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).first().click();

  // Both cards sit under Vocab — open that type to see them.
  await page.getByRole("button", { name: /Vocab/ }).click();
  await expect(page.locator(".study-item__front", { hasText: "テスト" })).toBeVisible();
  await expect(page.locator(".study-item__front", { hasText: "水" })).toBeVisible();
  await page.getByRole("button", { name: "Back to card types" }).click();

  // Cram the whole list, then grade a card.
  await page.getByRole("button", { name: /Study now/ }).click();
  await expect(page.locator(".practice-bar")).toBeVisible();
  // Reveal + grade the first card.
  await page.getByRole("button", { name: /Tap to reveal/i }).click();
  await page.getByRole("button", { name: /Got it/i }).click();
  await expect(page.locator(POST_GRADE).first()).toBeVisible();
});

test("study: a long list groups by type, paginates, and opens a card", async ({ page }) => {
  await login(page);

  // The seeded list holds 26 cards: 25 vocab (two pages) + one kanji.
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await page.getByRole("button", { name: /Long list/ }).click();
  await expect(page.getByRole("heading", { name: "Long list" })).toBeVisible();

  // Type sections, not 26 rows.
  await expect(page.locator(".study-item")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Kanji/ })).toBeVisible();

  // Into Vocab: 20 on the first page, the remaining 5 on the second.
  await page.getByRole("button", { name: /Vocab/ }).click();
  await expect(page.locator(".study-item")).toHaveCount(20);
  await expect(page.getByText("Page 1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await expect(page.locator(".study-item")).toHaveCount(5);

  // Tapping a row opens that card.
  await page.locator(".study-item__open").first().click();
  const sheet = page.getByRole("dialog", { name: "Card detail" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Not studied yet")).toBeVisible();
  await sheet.getByRole("button", { name: "Close card" }).click();
  await expect(sheet).toBeHidden();

  // Back steps up to the type sections, not out to the lists screen.
  await page.getByRole("button", { name: "Back to card types" }).click();
  await expect(page.getByRole("button", { name: /Kanji/ })).toBeVisible();
});

test("study: deleting a list takes a second, deliberate confirmation", async ({ page }) => {
  await login(page);

  await page.getByRole("button", { name: "Study", exact: true }).click();
  await page.getByRole("button", { name: /Long list/ }).click();
  await expect(page.getByRole("heading", { name: "Long list" })).toBeVisible();

  // The link alone doesn't delete anything — it asks first.
  await page.getByRole("button", { name: "Delete this list" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this list" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText(/26 cards/)).toBeVisible();

  // Backing out leaves the list alone.
  await confirm.getByRole("button", { name: "Keep list" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("heading", { name: "Long list" })).toBeVisible();

  // Confirming deletes it and returns to the lists screen.
  await page.getByRole("button", { name: "Delete this list" }).click();
  await page.getByRole("dialog", { name: "Delete this list" })
    .getByRole("button", { name: "Delete forever" }).click();
  await expect(page.getByRole("heading", { name: "Study" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Long list/ })).toBeHidden();
});
