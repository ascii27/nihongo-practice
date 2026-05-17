import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { reviewsRouter } from "./reviews.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/reviews", reviewsRouter));

async function insertItem(): Promise<string> {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ('vocab', $1, $2, 'seed', $3) RETURNING id`,
    [
      JSON.stringify({ sentence_ruby: "x", target: "x", sentence_english: "x" }),
      JSON.stringify({ meaning: "y", reading: "y" }),
      `e-${Math.random()}`,
    ],
  );
  return r.rows[0].id;
}

beforeEach(() => resetDb());

describe("POST /api/reviews", () => {
  it("creates state on first review and returns it", async () => {
    const itemId = await insertItem();
    const reviewedAt = new Date().toISOString();
    const res = await request(app)
      .post("/api/reviews")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: reviewedAt });
    expect(res.status).toBe(200);
    expect(res.body.box).toBe(1);
    expect(res.body.total_reviews).toBe(1);
    expect(res.body.total_missed).toBe(0);
    expect(typeof res.body.next_review_at).toBe("string");
  });

  it("increments box on subsequent got_it", async () => {
    const itemId = await insertItem();
    // Simulate an existing review_state with box=1, last reviewed yesterday
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, last_reviewed_at, total_reviews)
       VALUES ($1, 1, now() - interval '1 hour', now() - interval '1 day', 1)`,
      [itemId],
    );
    const res = await request(app)
      .post("/api/reviews")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: new Date().toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.box).toBe(2);
    expect(res.body.total_reviews).toBe(2);
  });

  it("missed resets box to 1 and increments total_missed", async () => {
    const itemId = await insertItem();
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, total_reviews, total_missed)
       VALUES ($1, 4, now() - interval '1 hour', 5, 1)`,
      [itemId],
    );
    const res = await request(app)
      .post("/api/reviews")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "missed", reviewed_at: new Date().toISOString() });
    expect(res.body.box).toBe(1);
    expect(res.body.total_missed).toBe(2);
  });

  it("is idempotent on duplicate (item_id, reviewed_at)", async () => {
    const itemId = await insertItem();
    const reviewedAt = new Date().toISOString();
    const first = await request(app).post("/api/reviews").set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: reviewedAt });
    const second = await request(app).post("/api/reviews").set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: reviewedAt });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    const r = await pool.query(`SELECT count(*)::int as c FROM reviews WHERE item_id = $1`, [itemId]);
    expect(r.rows[0].c).toBe(1);
    const s = await pool.query(`SELECT total_reviews FROM review_state WHERE item_id = $1`, [itemId]);
    expect(s.rows[0].total_reviews).toBe(1);
  });

  it("rejects unknown item with 404", async () => {
    const res = await request(app)
      .post("/api/reviews").set("X-Passcode", PASSCODE)
      .send({ item_id: "00000000-0000-0000-0000-000000000000", result: "got_it", reviewed_at: new Date().toISOString() });
    expect(res.status).toBe(404);
  });

  it("attaches session_id when provided", async () => {
    const itemId = await insertItem();
    const sess = await pool.query(`INSERT INTO sessions DEFAULT VALUES RETURNING id`);
    const sessionId = sess.rows[0].id;
    await request(app).post("/api/reviews").set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: new Date().toISOString(), session_id: sessionId });
    const r = await pool.query(`SELECT session_id FROM reviews WHERE item_id = $1`, [itemId]);
    expect(r.rows[0].session_id).toBe(sessionId);
  });

  it("persists answer_given when provided", async () => {
    const itemId = await insertItem();
    await request(app).post("/api/reviews").set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: new Date().toISOString(), answer_given: "食べました" });
    const r = await pool.query(`SELECT answer_given FROM reviews WHERE item_id = $1`, [itemId]);
    expect(r.rows[0].answer_given).toBe("食べました");
  });
});
