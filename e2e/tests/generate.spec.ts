import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login, generateCards, openLibrary, expectSkillCount } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

test("empty dashboard → generate vocab in Library → Today counts them", async ({ page }) => {
  await login(page);
  // The empty hero points at the add hero below it rather than at Settings.
  await expect(page.getByText(/all caught up\. Add more below/i)).toBeVisible();

  await generateCards(page, "vocab");
  // Fake AI returns 5 vocab items (VOCAB_FAKE has 5 entries).
  await expect(page.locator(".library__count")).toHaveText(/^5 cards/);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.locator(".today__hero-count")).toContainText("5", { timeout: 10_000 });
});

test("Today's add hero adds a word, a kanji and a grammar point", async ({ page }) => {
  await login(page);
  const add = page.getByRole("region", { name: "Add cards" });

  await add.getByRole("tab", { name: "Vocab" }).click();
  await add.getByPlaceholder(/Word/).fill("cat");
  await add.getByRole("button", { name: "Generate" }).click();
  await add.getByRole("button", { name: "Add to deck" }).click();
  await expect(add.getByRole("status")).toContainText(/to your deck/);
  await expect(page.locator(".today__hero-count")).toContainText("1", { timeout: 10_000 });

  await add.getByRole("tab", { name: "Kanji" }).click();
  await add.getByPlaceholder(/Kanji/).fill("食");
  await add.getByRole("button", { name: "Generate" }).click();
  await add.getByLabel("Meaning").fill("eat");
  await add.getByRole("button", { name: "Add to deck" }).click();
  await expect(add.getByRole("status")).toContainText("Added 食");

  await add.getByRole("tab", { name: "Grammar" }).click();
  await add.getByPlaceholder(/Pattern/).fill("〜てから");
  await add.getByRole("button", { name: "Generate" }).click();
  await add.getByRole("button", { name: "Add to deck" }).click();
  await expect(add.getByRole("status")).toBeVisible();

  await expectSkillCount(page, "kanji", 1);
  await expectSkillCount(page, "grammar", 1);
});

test("settings lists the run after generation", async ({ page }) => {
  await login(page);
  await generateCards(page, "vocab");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.locator(".settings__gen-item")).toHaveCount(1);
});
