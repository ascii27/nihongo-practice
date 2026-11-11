import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-tags");
});

async function openLibrary(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
}

test("library: create tag → quick-add → search-add → cards carry the tag", async ({ page }) => {
  await login(page);
  await openLibrary(page);

  await page.getByRole("button", { name: "+ New tag" }).click();
  const create = page.getByRole("dialog", { name: "New tag" });
  await create.getByLabel("Tag name").fill("Week 5");
  await create.getByRole("button", { name: "Create tag" }).click();
  await expect(page.getByRole("heading", { name: "Week 5" })).toBeVisible();
  await expect(page.getByText("0 cards")).toBeVisible();

  await page.getByRole("button", { name: "Add cards" }).click();
  const add = page.getByRole("dialog", { name: "Add cards" });
  await add.getByRole("tab", { name: /Quick-add new/ }).click();
  await add.getByPlaceholder(/Word/).fill("test");
  await add.getByRole("button", { name: "Generate" }).click();
  await add.getByRole("button", { name: "Add to tag" }).click();

  await add.getByRole("tab", { name: /Search & add/ }).click();
  await add.getByPlaceholder("Search your cards…").fill("fire");
  await add.getByRole("button", { name: "Search", exact: true }).click();
  await add.getByRole("button", { name: "Add", exact: true }).first().click();
  await add.getByRole("button", { name: "Close add cards" }).click();

  await expect(page.locator(".study-item__front", { hasText: "テスト" })).toBeVisible();
  await expect(page.locator(".study-item__front", { hasText: "火" })).toBeVisible();
  await expect(page.getByText("2 cards")).toBeVisible();
});

test("library: a duplicate tag name is refused", async ({ page }) => {
  await login(page);
  await openLibrary(page);
  await page.getByRole("button", { name: "+ New tag" }).click();
  const create = page.getByRole("dialog", { name: "New tag" });
  await create.getByLabel("Tag name").fill("  coto academy ");
  await create.getByRole("button", { name: "Create tag" }).click();
  await expect(create.getByRole("alert")).toContainText(/already exists/);
});

test("library: tag a card from its sheet, then untag it", async ({ page }) => {
  await login(page);
  await openLibrary(page);
  await page.getByLabel("Search library").fill("water");
  // Search is debounced: wait for the matching row, not whatever is first now.
  await page.locator(".study-item__open", { hasText: "水" }).click();
  const sheet = page.getByRole("dialog", { name: "Card detail" });
  await sheet.getByLabel("Add tag").selectOption({ label: "Long list" });
  await expect(sheet.getByRole("button", { name: "Remove tag Long list" })).toBeVisible();
  await sheet.getByRole("button", { name: "Remove tag Long list" }).click();
  await expect(sheet.getByRole("button", { name: "Remove tag Long list" })).toBeHidden();
  await expect(sheet.getByRole("button", { name: "Remove tag Coto Academy" })).toBeVisible();
});

test("library: the card list fits the viewport with the pager always reachable", async ({ page }) => {
  await login(page);
  await openLibrary(page);

  const pager = page.getByRole("navigation", { name: "Pages" });
  await expect(pager).toBeInViewport();
  await expect(page.getByText("Page 1 of 2")).toBeVisible();
  await expect(page.locator(".study-item")).toHaveCount(50);

  const scrolls = await page.evaluate(() => {
    const list = document.querySelector(".library__items")!;
    return {
      page: document.documentElement.scrollHeight > window.innerHeight + 1,
      list: list.scrollHeight > list.clientHeight,
    };
  });
  expect(scrolls).toEqual({ page: false, list: true });

  await page.evaluate(() => {
    const list = document.querySelector(".library__items")!;
    list.scrollTop = list.scrollHeight;
  });
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await expect(page.locator(".study-item")).toHaveCount(8);
  expect(await page.evaluate(() => document.querySelector(".library__items")!.scrollTop)).toBe(0);
});

test("library: Review this tag focuses Today on that tag", async ({ page }) => {
  await login(page);
  await openLibrary(page);
  await page.getByRole("button", { name: /^Long list/ }).click();
  await expect(page.getByText("26 cards")).toBeVisible();
  await page.getByRole("button", { name: "Review this tag" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear focus Long list" })).toBeVisible();
});

test("library: renaming a tag, and deleting one keeps its cards", async ({ page }) => {
  await login(page);
  await openLibrary(page);
  await page.getByRole("button", { name: /^Long list/ }).click();

  await page.getByRole("button", { name: "Manage tag" }).click();
  const manage = page.getByRole("dialog", { name: "Manage tag" });
  await manage.getByLabel("Tag name").fill("Week 1");
  await manage.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("heading", { name: "Week 1" })).toBeVisible();

  await page.getByRole("button", { name: "Manage tag" }).click();
  await page.getByRole("dialog", { name: "Manage tag" }).getByRole("button", { name: "Delete tag" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this tag" });
  await expect(confirm.getByText(/26 cards/)).toBeVisible();
  await confirm.getByRole("button", { name: "Keep tag" }).click();
  await expect(confirm).toBeHidden();

  await page.getByRole("button", { name: "Manage tag" }).click();
  await page.getByRole("dialog", { name: "Manage tag" }).getByRole("button", { name: "Delete tag" }).click();
  await page.getByRole("dialog", { name: "Delete this tag" }).getByRole("button", { name: "Delete tag" }).click();
  await expect(page.getByRole("button", { name: /^Week 1/ })).toBeHidden();
  await page.getByLabel("Search library").fill("word 1");
  await expect(page.locator(".study-item__front", { hasText: "語1" }).first()).toBeVisible();
});

test("library: a kanji card offers its mnemonic, and writes one on demand", async ({ page }) => {
  await login(page);
  await openLibrary(page);
  await page.getByLabel("Skill").selectOption({ label: "Kanji" });
  await page.locator(".study-item__open").first().click();

  // Nothing has been written for this kanji yet, so the sheet offers to —
  // opening a card must not spend tokens on its own.
  const sheet = page.getByRole("dialog", { name: "Card detail" });
  await expect(sheet.getByText("No memory aid for this kanji yet.")).toBeVisible();
  await sheet.getByRole("button", { name: "Write a mnemonic" }).click();
  await expect(sheet.locator(".kanji-mnemonic__hookline").first()).toBeVisible();

  await sheet.getByRole("button", { name: "Close card" }).click();
  await page.locator(".study-item__open").first().click();
  await expect(sheet.locator(".kanji-mnemonic__hookline").first()).toBeVisible();
});

test("library: a slow earlier search can't overwrite the latest results", async ({ page }) => {
  await login(page);
  await openLibrary(page);
  await page.route(/\/api\/library\?.*q=fire/, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const search = page.getByLabel("Search library");
  await search.fill("fire");
  await page.waitForTimeout(400);           // let the "fire" request go out
  await search.fill("water");
  await expect(page.locator(".study-item__front", { hasText: "水" })).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.locator(".study-item__front", { hasText: "水" })).toBeVisible();
  await expect(page.locator(".study-item__front", { hasText: "火" })).toHaveCount(0);
});
