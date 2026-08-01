import { describe, it, expect, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { resetDb } from "../db/reset.js";
import { getDailyBudget, unlockRound, countIntroducedToday, previewRound } from "./daily-budget.js";

// Reviews need a real item to point at.
async function insertItem(skill = "vocab"): Promise<string> {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ($1, '{}'::jsonb, '{}'::jsonb, 'seed', $2) RETURNING id`,
    [skill, `e-${Math.random()}`],
  );
  return r.rows[0].id;
}

// `hoursAgo` is relative to now, so tests stay independent of the wall clock.
async function insertReview(
  itemId: string,
  opts: { hoursAgo?: number; boxBefore?: number; cram?: boolean } = {},
) {
  await pool.query(
    `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after, cram)
     VALUES ($1, now() - make_interval(hours => $2::int), 'got_it', $3::int, $3::int + 1, $4)`,
    [itemId, opts.hoursAgo ?? 0, opts.boxBefore ?? 1, opts.cram ?? false],
  );
}

beforeEach(() => resetDb());

describe("getDailyBudget", () => {
  it("returns the default target and a full allowance with no reviews", async () => {
    const b = await getDailyBudget("UTC");
    expect(b).toEqual({ target: 30, extra_rounds: 0, allowance: 30, reviewed: 0, remaining: 30 });
  });

  it("subtracts reviews logged today", async () => {
    const id = await insertItem();
    await insertReview(id);
    await insertReview(id);
    const b = await getDailyBudget("UTC");
    expect(b.reviewed).toBe(2);
    expect(b.remaining).toBe(28);
  });

  it("ignores reviews from previous days", async () => {
    const id = await insertItem();
    await insertReview(id, { hoursAgo: 72 });
    const b = await getDailyBudget("UTC");
    expect(b.reviewed).toBe(0);
    expect(b.remaining).toBe(30);
  });

  it("floors remaining at zero when reviews exceed the allowance", async () => {
    const id = await insertItem();
    for (let i = 0; i < 32; i++) await insertReview(id);
    const b = await getDailyBudget("UTC");
    expect(b.reviewed).toBe(32);
    expect(b.remaining).toBe(0);
  });

  it("honours a changed target", async () => {
    await pool.query(`UPDATE app_settings SET daily_review_target = 50`);
    const b = await getDailyBudget("UTC");
    expect(b.target).toBe(50);
    expect(b.allowance).toBe(50);
    expect(b.remaining).toBe(50);
  });

  it("buckets by the caller's timezone, not UTC", async () => {
    const id = await insertItem();

    // Both reviews are anchored to midnight in Pacific/Honolulu (UTC-10, no
    // DST), so the assertions hold at every hour of the real clock. 30 minutes
    // after HST midnight is unambiguously "today" in HST.
    await pool.query(
      `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
       VALUES ($1, (date_trunc('day', now() AT TIME ZONE 'Pacific/Honolulu') + interval '30 minutes')
                     AT TIME ZONE 'Pacific/Honolulu', 'got_it', 1, 2)`,
      [id],
    );
    expect((await getDailyBudget("Pacific/Honolulu")).reviewed).toBe(1);

    // 30 minutes *before* that same midnight is the previous HST day and must
    // not be counted. A UTC-bucketing implementation places these two reviews
    // differently (they straddle no UTC boundary — both land on the same UTC
    // date, giving 2) and so fails this assertion.
    await pool.query(
      `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
       VALUES ($1, (date_trunc('day', now() AT TIME ZONE 'Pacific/Honolulu') - interval '30 minutes')
                     AT TIME ZONE 'Pacific/Honolulu', 'got_it', 1, 2)`,
      [id],
    );
    expect((await getDailyBudget("Pacific/Honolulu")).reviewed).toBe(1);
  });

  it("does not spend the allowance on cram reviews", async () => {
    const id = await insertItem();
    for (let i = 0; i < 40; i++) await insertReview(id, { cram: true });
    const b = await getDailyBudget("UTC");
    expect(b.reviewed).toBe(0);
    expect(b.remaining).toBe(30);
  });

  it("counts ordinary reviews alongside cram reviews", async () => {
    const id = await insertItem();
    await insertReview(id, { cram: true });
    await insertReview(id);
    const b = await getDailyBudget("UTC");
    expect(b.reviewed).toBe(1);
    expect(b.remaining).toBe(29);
  });
});

describe("unlockRound", () => {
  it("adds one full target to the allowance", async () => {
    const b = await unlockRound("UTC");
    expect(b.extra_rounds).toBe(1);
    expect(b.allowance).toBe(60);
    expect(b.remaining).toBe(60);
  });

  it("is repeatable and accumulates", async () => {
    await unlockRound("UTC");
    await unlockRound("UTC");
    const b = await getDailyBudget("UTC");
    expect(b.extra_rounds).toBe(2);
    expect(b.allowance).toBe(90);
  });

  it("keeps reviews already logged subtracted", async () => {
    const id = await insertItem();
    for (let i = 0; i < 30; i++) await insertReview(id);
    expect((await getDailyBudget("UTC")).remaining).toBe(0);
    const b = await unlockRound("UTC");
    expect(b.remaining).toBe(30);
  });
});

describe("previewRound", () => {
  it("matches what unlockRound would persist, without persisting it", async () => {
    const id = await insertItem();
    for (let i = 0; i < 10; i++) await insertReview(id);
    const before = await getDailyBudget("UTC");

    const predicted = previewRound(before);
    expect(await getDailyBudget("UTC")).toEqual(before); // nothing written

    expect(await unlockRound("UTC")).toEqual(predicted);
  });

  it("stacks on rounds already unlocked", async () => {
    await unlockRound("UTC");
    const p = previewRound(await getDailyBudget("UTC"));
    expect(p.extra_rounds).toBe(2);
    expect(p.allowance).toBe(90);
  });
});

describe("countIntroducedToday", () => {
  it("counts only first-ever reviews from today", async () => {
    const id = await insertItem();
    await insertReview(id, { boxBefore: 0 });               // introduction today
    await insertReview(id, { boxBefore: 2 });               // ordinary review
    await insertReview(id, { boxBefore: 0, hoursAgo: 72 }); // introduction, but not today
    expect(await countIntroducedToday("UTC")).toBe(1);
  });

  it("counts across all skills, not per skill", async () => {
    const v = await insertItem("vocab");
    const g = await insertItem("grammar");
    await insertReview(v, { boxBefore: 0 });
    await insertReview(g, { boxBefore: 0 });
    expect(await countIntroducedToday("UTC")).toBe(2);
  });

  // Deliberately the opposite of the budget's treatment of cram: cramming a
  // brand-new card still introduces it to the SRS, so it counts against the
  // day's new-card pacing even though it costs no allowance.
  it("counts cram introductions, unlike the allowance", async () => {
    const id = await insertItem();
    await insertReview(id, { boxBefore: 0, cram: true });
    expect(await countIntroducedToday("UTC")).toBe(1);
    expect((await getDailyBudget("UTC")).reviewed).toBe(0);
  });
});
