import { execSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login } from "./helpers";

function sql(statement: string): void {
  execSync(`psql "${process.env.DATABASE_URL}" -v ON_ERROR_STOP=1 -c "${statement}"`, { stdio: "ignore" });
}

test.beforeEach(() => {
  loadFixture("seed-test-tags");
});

test.afterEach(async ({ page }) => {
  // The chosen hero tab is remembered per device; don't leak it into other specs.
  await page.evaluate(() => localStorage.removeItem("nihongo.heroTab")).catch(() => {});
});

test("srs: the SRS tab reviews the whole deck, past the daily target and the focus", async ({ page }) => {
  // Target 10, already met today; every card is due. Daily has nothing to deal.
  sql(`UPDATE app_settings SET daily_review_target = 10`);
  sql(`INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
       SELECT id, now(), 'got_it', 1, 1 FROM items, generate_series(1, 10) LIMIT 10`);
  sql(`INSERT INTO review_state (item_id, box, next_review_at, total_reviews)
       SELECT id, 2, now() - interval '1 hour', 1 FROM items`);
  const total = Number(execSync(`psql "${process.env.DATABASE_URL}" -tAc "SELECT count(*) FROM items"`).toString().trim());

  await login(page);
  await expect(page.getByText("今日の分、終わり")).toBeVisible();

  await page.getByRole("tab", { name: "SRS" }).click();
  await expect(page.getByRole("tab", { name: "SRS" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".today__hero-count")).toHaveText(String(total));
  // The focus pickers belong to Daily; SRS is always the whole deck.
  await expect(page.getByLabel("Skill")).toHaveCount(0);

  await page.getByRole("button", { name: "Start SRS review" }).click();
  await expect(page.locator(".practice-bar__count")).toHaveText(`1/${total}`);

  // Closing the session lands back on the SRS tab.
  await page.getByRole("button", { name: "Close practice" }).click();
  await expect(page.getByRole("tab", { name: "SRS" })).toHaveAttribute("aria-selected", "true");

  // Tapping a skill row focuses Daily on that skill.
  await page.locator(".skill-card--kanji").click();
  await expect(page.getByRole("tab", { name: "Daily" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Skill")).toHaveValue("kanji");
});

test("srs: past the per-session cap, the number is the whole deck's backlog and the button names the sitting", async ({ page }) => {
  // 210 due cards: more than one 200-card sitting.
  sql(`INSERT INTO items (skill, prompt, answer, source, external_id)
       SELECT 'vocab', '{\\"sentence_ruby\\":\\"x\\",\\"target\\":\\"x\\",\\"sentence_english\\":\\"x\\"}',
              '{\\"meaning\\":\\"y\\",\\"reading\\":\\"y\\"}', 'seed', 'srs-cap-' || g
         FROM generate_series(1, 210) g`);
  sql(`INSERT INTO review_state (item_id, box, next_review_at, total_reviews)
       SELECT id, 2, now() - interval '1 hour', 1 FROM items WHERE external_id LIKE 'srs-cap-%'`);
  // The fixture's own due cards count too; new cards don't fit a full sitting.
  const due = Number(execSync(`psql "${process.env.DATABASE_URL}" -tAc "SELECT count(*) FROM review_state WHERE next_review_at <= now() AND NOT suspended"`).toString().trim());

  await login(page);
  await page.getByRole("tab", { name: "SRS" }).click();
  await expect(page.locator(".today__hero-count")).toHaveText(String(due));
  await expect(page.getByText("200 per session")).toBeVisible();
  await page.getByRole("button", { name: "Review 200" }).click();
  await expect(page.locator(".practice-bar__count")).toHaveText("1/200");
});
