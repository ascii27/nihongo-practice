import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login, generateCards, openLibrary, expectSkillCount } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

test("empty dashboard → generate vocab from Today's add hero → the practice hero counts them", async ({ page }) => {
  await login(page);
  // The empty hero points at the add hero below it rather than at Settings.
  await expect(page.getByText(/all caught up\. Add more below/i)).toBeVisible();

  await generateCards(page, "vocab");
  // Fake AI returns 5 vocab items (VOCAB_FAKE has 5 entries), and the practice
  // hero picks them up without leaving Today.
  await expect(page.locator(".today__hero-count")).toContainText("5", { timeout: 10_000 });
});

test("add a word from Today's add hero", async ({ page }) => {
  await login(page);
  const add = page.getByRole("region", { name: "Add cards" });
  await add.getByRole("tab", { name: "Add a word" }).click();
  await add.getByLabel(/Word or phrase/).fill("cat");
  await add.getByRole("button", { name: "Translate" }).click();
  await add.getByRole("button", { name: /^Add to deck/ }).click();
  await expect(add.getByText(/^Added/)).toBeVisible();
  await expect(page.locator(".today__hero-count")).toContainText("1", { timeout: 10_000 });
});

test("Library's skill view hands off to Today's add hero, preset to that skill", async ({ page }) => {
  await login(page);
  await openLibrary(page);
  await page.locator(".skill-card--grammar").click();
  await page.getByRole("button", { name: "Add grammar" }).click();

  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  const add = page.getByRole("region", { name: "Add cards" });
  await expect(add.getByRole("tab", { name: "Generate" })).toHaveAttribute("aria-selected", "true");
  await expect(add.getByLabel("Card type")).toHaveValue("grammar");
  await expect(add).toBeInViewport();

  await add.getByRole("button", { name: /^Generate \d+ grammar/ }).click();
  await expect(add.getByRole("status")).toBeVisible({ timeout: 15_000 });
  await expectSkillCount(page, "grammar", 3);
});

test("kanji can't be generated, so its skill view offers study only", async ({ page }) => {
  await login(page);
  await openLibrary(page);
  await page.locator(".skill-card--kanji").click();
  await expect(page.getByRole("button", { name: "Study this skill" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Add kanji/ })).toHaveCount(0);
});

test("settings lists the run after generation", async ({ page }) => {
  await login(page);
  await generateCards(page, "vocab");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.locator(".settings__gen-item")).toHaveCount(1);
});
