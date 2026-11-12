import { execSync } from "node:child_process";
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
  // Search is debounced: wait for the matching row, not whatever is first now.
  await page.locator(".study-item__open", { hasText: "水" }).click();
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

test("focus: a slow response for an earlier focus can't overwrite the current one", async ({ page }) => {
  await login(page);
  // Hold back the Vocab-only dashboard response so it lands after the
  // Vocab × Coto one. Vocab alone deals 10; Vocab × Coto deals 1.
  await page.route(/\/api\/dashboard\?(?=.*skill=vocab)(?!.*tag=)/, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.getByLabel("Skill").selectOption({ label: "Vocab" });
  await page.getByLabel("Tag").selectOption({ label: "Coto Academy (2)" });
  await expect(page.locator(".today__hero-count")).toHaveText("1");
  await page.waitForTimeout(2000);
  await expect(page.getByText("cards · Vocab × Coto Academy")).toBeVisible();
  await expect(page.locator(".today__hero-count")).toHaveText("1");
});

test("focus: the pickers are 16px so iOS doesn't zoom on tap", async ({ page }) => {
  await login(page);
  const size = await page.getByLabel("Skill").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});

function sql(statement: string): void {
  execSync(`psql "${process.env.DATABASE_URL}" -v ON_ERROR_STOP=1 -c "${statement}"`, { stdio: "ignore" });
}

test("focus: a met target says so, rather than 'nothing due', and a skill-only drill is a sample", async ({ page }) => {
  // Target 10, already reviewed 10 today; 水 (Vocab × Coto) is due right now.
  sql(`UPDATE app_settings SET daily_review_target = 10`);
  sql(`INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
       SELECT id, now() - make_interval(secs => n), 'got_it', 1, 2
         FROM (SELECT id, row_number() OVER () AS n FROM items WHERE external_id LIKE 'filler-%' LIMIT 10) f`);
  sql(`INSERT INTO review_state (item_id, box, next_review_at) SELECT id, 1, now() - interval '1 hour' FROM items WHERE external_id = 'study-001'`);

  await login(page);
  await page.getByLabel("Skill").selectOption({ label: "Vocab" });
  await page.getByLabel("Tag").selectOption({ label: "Coto Academy (2)" });
  await expect(page.getByText(/Today's target is done/)).toBeVisible();
  await expect(page.getByText(/Nothing due/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Drill all 1 anyway" })).toBeVisible();

  // Vocab alone has far more than 50 cards: the drill is a sample, and says so.
  await page.getByLabel("Tag").selectOption({ label: "All" });
  await expect(page.getByRole("button", { name: "Drill 50 anyway" })).toBeVisible();
});
