// Primary user journeys at iPhone 17 size, Home-Screen insets emulated.
// See docs/user-journeys.md. Titles tagged @readonly only look — they also run
// against production with E2E_READ_ONLY=1 (`npm run e2e:prod`). Everything
// else writes, so it runs only on the local throwaway database.
import type { Page } from "@playwright/test";
import { test, expect, seed, login, expectFits } from "./support";

const reveal = (page: Page) => page.getByRole("button", { name: /Tap to reveal/i });
const gotIt = (page: Page) => page.getByRole("button", { name: /^Got it$/ });
const missed = (page: Page) => page.getByRole("button", { name: /^Missed$/ });

const closePractice = (page: Page) => page.getByRole("button", { name: "Close practice" });

// One card, front then back: each face fits, with the way out (top) and the
// card's controls (bottom) both on screen.
async function reviewCard(page: Page, step: string): Promise<void> {
  await expectFits(page, `${step} front`, [closePractice(page), reveal(page)]);
  await reveal(page).click();
  await expectFits(page, `${step} back`, [closePractice(page), missed(page), gotIt(page)]);
  await gotIt(page).click();
}

test.describe("J1 daily review", () => {
  test("Today → mixed practice → grade cards → summary", async ({ page }) => {
    seed("seed-journeys");
    await login(page);
    const start = page.getByRole("button", { name: "Start mixed practice" });
    await expectFits(page, "Today", [start]);
    await start.click();
    for (let i = 1; i <= 3; i++) await reviewCard(page, `card ${i}`);
  });

  test("a long reading card keeps its grade buttons on screen", async ({ page }) => {
    seed("seed-journeys");
    await login(page);
    await page.getByLabel("Skill").selectOption({ label: "Reading" });
    await page.getByRole("button", { name: "Start focused practice" }).click();
    await reviewCard(page, "reading");
  });
});

test.describe("J2 class review", () => {
  test("focus on the class tag → focused session", async ({ page }) => {
    seed("seed-journeys");
    await login(page);
    await page.getByLabel("Tag").selectOption({ label: "Coto Academy (3)" });
    const start = page.getByRole("button", { name: "Start focused practice" });
    await expectFits(page, "focused hero", [start]);
    await start.click();
    await reviewCard(page, "class card");
  });
});

test.describe("J3 before class", () => {
  test("nothing due in the focus → drill it anyway", async ({ page }) => {
    seed("seed-journeys");
    await login(page);
    await page.getByLabel("Skill").selectOption({ label: "Vocab" });
    await page.getByLabel("Tag").selectOption({ label: "Coto Academy (3)" });
    await page.getByRole("button", { name: "Start focused practice" }).click();
    await reviewCard(page, "introduce 水");
    await page.getByRole("button", { name: "Back to Today" }).click();

    const drill = page.getByRole("button", { name: "Drill all 1 anyway" });
    await expectFits(page, "drill offer", [drill]);
    await drill.click();
    await reviewCard(page, "drill card");
  });
});

test.describe("J4 add class material", () => {
  test("Library → class tag → add a card", async ({ page }) => {
    seed("seed-journeys");
    await login(page);
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("button", { name: /^Coto Academy/ }).click();
    await expectFits(page, "tag view", [
      page.getByRole("button", { name: "Review this tag" }),
      page.getByRole("button", { name: "Add cards" }),
      page.getByRole("button", { name: "Manage tag" }),
    ]);

    await page.getByRole("button", { name: "Add cards" }).click();
    const sheet = page.getByRole("dialog", { name: "Add cards" });
    await sheet.getByRole("tab", { name: /Quick-add new/ }).click();
    await expectFits(page, "add-cards sheet", [
      sheet.getByRole("button", { name: "Close add cards" }),
      sheet.getByRole("button", { name: "Generate" }),
    ]);
    await sheet.getByPlaceholder(/Word/).fill("test");
    await sheet.getByRole("button", { name: "Generate" }).click();
    const add = sheet.getByRole("button", { name: "Add to tag" });
    await add.scrollIntoViewIfNeeded();
    await expectFits(page, "quick-add preview", [add, sheet.getByRole("button", { name: "Close add cards" })]);
    await add.click();
    await sheet.getByRole("button", { name: "Close add cards" }).click();
    await expect(page.getByText("4 cards")).toBeVisible();
  });
});

test.describe("J5 browse and tag", () => {
  test("search → open a card → tag it", async ({ page }) => {
    seed("seed-journeys");
    await login(page);
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByLabel("Search library").fill("fire");
    await page.locator(".study-item__open", { hasText: "火" }).click();
    const sheet = page.getByRole("dialog", { name: "Card detail" });
    await expectFits(page, "card sheet", [sheet.getByRole("button", { name: "Close card" })]);
    const addTag = sheet.getByLabel("Add tag");
    await addTag.scrollIntoViewIfNeeded();
    await expectFits(page, "card sheet, tags", [addTag, sheet.getByRole("button", { name: "Close card" })]);
    await addTag.selectOption({ label: "Coto Academy" });
    await expect(sheet.getByRole("button", { name: "Remove tag Coto Academy" })).toBeVisible();
  });
});

// ---- Read-only: safe against production -----------------------------------

test.describe("@readonly views", () => {
  test.beforeEach(async () => {
    if (!process.env.E2E_READ_ONLY) seed("seed-journeys");
  });

  test("@readonly Today fits, with and without a focus", async ({ page }) => {
    await login(page);
    // Today is a long page that scrolls inside its screen: every section must
    // keep its full height (nothing squashed or clipped) and be reachable.
    const sections = [
      page.locator(".today__hero-label").first(),
      page.locator(".today__hero-count").first(),
      page.locator(".today__hero-cta").first(),
    ];
    for (const s of sections) await s.scrollIntoViewIfNeeded();
    await expectFits(page, "Today hero", sections);
    const lastSkill = page.locator(".today__skill-row").last();
    await lastSkill.scrollIntoViewIfNeeded();
    await expectFits(page, "Today, last skill row", [lastSkill]);

    await page.getByLabel("Tag").selectOption({ index: 1 });
    const focused = [page.getByRole("button", { name: /^Clear focus/ }), page.locator(".today__hero-label").first()];
    for (const s of focused) await s.scrollIntoViewIfNeeded();
    await expectFits(page, "Today, focused", focused);
    await page.getByRole("button", { name: /^Clear focus/ }).click();
  });

  test("@readonly Library fits, unfiltered and on a tag", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await expectFits(page, "Library", [page.getByRole("navigation", { name: "Pages" })]);
    await page.locator(".tag-chip").first().click();
    await expectFits(page, "Library, tag", [
      page.getByRole("button", { name: "Review this tag" }),
      page.getByRole("button", { name: "Manage tag" }),
      page.locator(".study-item__open").first(),
    ]);
  });

  test("@readonly a card sheet fits", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.locator(".study-item__open").first().click();
    const sheet = page.getByRole("dialog", { name: "Card detail" });
    await expectFits(page, "card sheet", [sheet.getByRole("button", { name: "Close card" })]);
    await sheet.getByRole("button", { name: "Close card" }).click();
  });
});
