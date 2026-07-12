import { describe, it, expect, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { resetDb } from "../db/reset.js";
import { detectStreakMilestone, isStreakThreshold } from "./streak.js";

async function insertItem(): Promise<string> {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ('vocab', '{}', '{}', 'seed', $1) RETURNING id`,
    [`e-${Math.random()}`],
  );
  return r.rows[0].id;
}

// Seed one review `daysAgo` days back (minus `secsAgo` seconds so same-day
// reviews get distinct timestamps).
async function seedReview(itemId: string, daysAgo: number, secsAgo = 0): Promise<void> {
  await pool.query(
    `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
     VALUES ($1, now() - make_interval(days => $2::int, secs => $3::int), 'got_it', 0, 1)`,
    [itemId, daysAgo, secsAgo],
  );
}

beforeEach(() => resetDb());

describe("isStreakThreshold", () => {
  it("recognizes only 7 / 14 / 30", () => {
    expect(isStreakThreshold(7)).toBe(true);
    expect(isStreakThreshold(14)).toBe(true);
    expect(isStreakThreshold(30)).toBe(true);
    expect(isStreakThreshold(6)).toBe(false);
    expect(isStreakThreshold(8)).toBe(false);
    expect(isStreakThreshold(0)).toBe(false);
  });
});

describe("detectStreakMilestone", () => {
  it("returns the threshold on the first review of a milestone day", async () => {
    const id = await insertItem();
    for (let k = 0; k < 7; k++) await seedReview(id, k); // today + 6 prior days
    expect(await detectStreakMilestone("UTC")).toBe(7);
  });

  it("returns null on a later same-day review (not the first)", async () => {
    const id = await insertItem();
    for (let k = 0; k < 7; k++) await seedReview(id, k);
    await seedReview(id, 0, 30); // a second review today
    expect(await detectStreakMilestone("UTC")).toBeNull();
  });

  it("returns null when the streak is below a threshold", async () => {
    const id = await insertItem();
    for (let k = 0; k < 5; k++) await seedReview(id, k); // 5-day streak
    expect(await detectStreakMilestone("UTC")).toBeNull();
  });

  it("returns null when there are no reviews", async () => {
    expect(await detectStreakMilestone("UTC")).toBeNull();
  });
});
