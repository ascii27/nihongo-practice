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
