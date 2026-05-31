import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { statsRouter } from "./stats.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/stats", statsRouter));

async function insertItemWithReview(reviewedAt: string): Promise<void> {
  const item = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ('vocab', $1, $2, 'seed', $3) RETURNING id`,
    [
      JSON.stringify({ sentence_ruby: "x", target: "x", sentence_english: "x" }),
      JSON.stringify({ meaning: "y", reading: "y" }),
      `e-${Math.random()}`,
    ],
  );
  await pool.query(
    `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
     VALUES ($1, $2, 'got_it', 1, 2)`,
    [item.rows[0].id, reviewedAt],
  );
}

beforeEach(() => resetDb());

describe("GET /api/stats/streak", () => {
  it("returns 0 when no reviews", async () => {
    const res = await request(app).get("/api/stats/streak?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ days: 0 });
  });

  it("returns 1 for a review today only", async () => {
    await insertItemWithReview(new Date().toISOString());
    const res = await request(app).get("/api/stats/streak?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body).toEqual({ days: 1 });
  });

  it("counts consecutive days back from today", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await insertItemWithReview(new Date(now).toISOString());
    await insertItemWithReview(new Date(now - day).toISOString());
    await insertItemWithReview(new Date(now - 2 * day).toISOString());
    const res = await request(app).get("/api/stats/streak?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body).toEqual({ days: 3 });
  });

  it("breaks the streak at a missed day", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await insertItemWithReview(new Date(now).toISOString());
    await insertItemWithReview(new Date(now - 2 * day).toISOString()); // skipped yesterday
    const res = await request(app).get("/api/stats/streak?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body).toEqual({ days: 1 });
  });

  it("returns 400 for missing tz", async () => {
    const res = await request(app).get("/api/stats/streak").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/stats/by-skill", () => {
  it("returns box_counts and accuracy per skill", async () => {
    // 3 vocab items: one in box 1, two in box 3. One missed review out of 5.
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await pool.query(
        `INSERT INTO items (skill, prompt, answer, source, external_id) VALUES ('vocab','{}','{}','seed',$1) RETURNING id`,
        [`s-${i}`],
      );
      ids.push(r.rows[0].id);
    }
    await pool.query(`INSERT INTO review_state (item_id, box, next_review_at) VALUES ($1, 1, now())`, [ids[0]]);
    await pool.query(`INSERT INTO review_state (item_id, box, next_review_at) VALUES ($1, 3, now()), ($2, 3, now())`, [ids[1], ids[2]]);
    // 5 reviews — 1 missed → accuracy 0.8
    for (let i = 0; i < 4; i++) {
      await pool.query(`INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after) VALUES ($1, now() - interval '1 hour' * $2, 'got_it', 1, 2)`, [ids[0], i]);
    }
    await pool.query(`INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after) VALUES ($1, now(), 'missed', 2, 1)`, [ids[0]]);

    const res = await request(app).get("/api/stats/by-skill").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.by_skill.vocab.box_counts).toEqual([1, 0, 2, 0, 0]);
    expect(res.body.by_skill.vocab.accuracy_30d).toBeCloseTo(0.8, 2);
    expect(res.body.by_skill.grammar.box_counts).toEqual([0, 0, 0, 0, 0]);
    expect(res.body.by_skill.grammar.accuracy_30d).toBeNull();
  });
});

describe("GET /api/stats/overview", () => {
  it("returns empty-but-shaped data with no reviews", async () => {
    const res = await request(app).get("/api/stats/overview?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.streak_days).toBe(0);
    expect(res.body.longest_streak).toBe(0);
    expect(res.body.total_reviewed).toBe(0);
    expect(res.body.overall_accuracy).toBeNull();
    expect(res.body.daily_reviews).toHaveLength(30);
    expect(res.body.daily_reviews.every((n: number) => n === 0)).toBe(true);
    expect(res.body.hardest_cards).toEqual([]);
  });

  it("computes totals, accuracy, longest streak and today's daily count", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    // Two consecutive days, then a gap, then today → longest run 2, current 1.
    await insertItemWithReview(new Date(now).toISOString());
    await insertItemWithReview(new Date(now - 3 * day).toISOString());
    await insertItemWithReview(new Date(now - 4 * day).toISOString());

    const res = await request(app).get("/api/stats/overview?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.total_reviewed).toBe(3);
    expect(res.body.overall_accuracy).toBeCloseTo(1.0, 5); // all got_it
    expect(res.body.streak_days).toBe(1);
    expect(res.body.longest_streak).toBe(2);
    expect(res.body.daily_reviews).toHaveLength(30);
    expect(res.body.daily_reviews[29]).toBe(1); // today is the last slot
  });

  it("surfaces the lowest-accuracy cards with ≥3 reviews", async () => {
    const mk = await pool.query(
      `INSERT INTO items (skill, prompt, answer, source, external_id)
       VALUES ('grammar', $1, $2, 'seed', $3) RETURNING id`,
      [
        JSON.stringify({ sentence_ruby: "x", pattern: "～なければならない", sentence_english: "x" }),
        JSON.stringify({ explanation: "must do" }),
        `hard-${Math.random()}`,
      ],
    );
    const id = mk.rows[0].id;
    // 4 reviews, 2 missed → accuracy 0.5
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, total_reviews, total_missed)
       VALUES ($1, 1, now(), 4, 2)`,
      [id],
    );
    const res = await request(app).get("/api/stats/overview?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.hardest_cards).toHaveLength(1);
    expect(res.body.hardest_cards[0]).toMatchObject({ skill: "grammar", front: "～なければならない" });
    expect(res.body.hardest_cards[0].accuracy).toBeCloseTo(0.5, 5);
  });

  it("rejects an invalid timezone", async () => {
    const res = await request(app).get("/api/stats/overview?tz=Not/AZone").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(400);
  });
});
