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
