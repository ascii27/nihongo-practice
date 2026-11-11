import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";

vi.mock("../services/hermes.js", () => ({
  emitReviewLogged: vi.fn(() => Promise.resolve()),
  emitMilestone: vi.fn(() => Promise.resolve()),
}));
import { emitReviewLogged, emitMilestone } from "../services/hermes.js";
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
  it("emits a review_logged event on fresh insert but not on idempotent duplicate", async () => {
    vi.mocked(emitReviewLogged).mockClear();
    const itemId = await insertItem();
    const reviewedAt = new Date().toISOString();

    await request(app).post("/api/reviews").set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: reviewedAt });
    await new Promise((r) => setTimeout(r, 25)); // let the fire-and-forget emit settle
    expect(emitReviewLogged).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(emitReviewLogged).mock.calls[0]![0];
    expect(arg.item_id).toBe(itemId);
    expect(arg.skill).toBe("vocab");
    expect(arg.result).toBe("got_it");
    expect(arg.box_before).toBe(0);
    expect(arg.box_after).toBe(1);

    // Re-submitting the same (item_id, reviewed_at) is idempotent — no new event.
    await request(app).post("/api/reviews").set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: reviewedAt });
    await new Promise((r) => setTimeout(r, 25));
    expect(emitReviewLogged).toHaveBeenCalledTimes(1);
  });

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

  it("suspends an item when total_missed reaches 8", async () => {
    const itemId = await insertItem();
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, total_reviews, total_missed)
       VALUES ($1, 1, now() - interval '1 hour', 10, 7)`,
      [itemId],
    );
    await request(app)
      .post("/api/reviews")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "missed", reviewed_at: new Date().toISOString() });
    const r = await pool.query(`SELECT total_missed, suspended FROM review_state WHERE item_id = $1`, [itemId]);
    expect(r.rows[0].total_missed).toBe(8);
    expect(r.rows[0].suspended).toBe(true);
  });

  it("does not suspend below 8 misses", async () => {
    const itemId = await insertItem();
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, total_reviews, total_missed)
       VALUES ($1, 1, now() - interval '1 hour', 10, 6)`,
      [itemId],
    );
    await request(app)
      .post("/api/reviews")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "missed", reviewed_at: new Date().toISOString() });
    const r = await pool.query(`SELECT total_missed, suspended FROM review_state WHERE item_id = $1`, [itemId]);
    expect(r.rows[0].total_missed).toBe(7);
    expect(r.rows[0].suspended).toBe(false);
  });

  it("stays suspended on a later got_it (one-way contract)", async () => {
    const itemId = await insertItem();
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, total_reviews, total_missed, suspended)
       VALUES ($1, 1, now() - interval '1 hour', 12, 8, true)`,
      [itemId],
    );
    await request(app)
      .post("/api/reviews")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: new Date().toISOString() });
    const r = await pool.query(`SELECT total_missed, suspended FROM review_state WHERE item_id = $1`, [itemId]);
    expect(r.rows[0].total_missed).toBe(8);
    expect(r.rows[0].suspended).toBe(true);
  });

  it("records a review as ordinary practice by default", async () => {
    const itemId = await insertItem();
    await request(app)
      .post("/api/reviews")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: new Date().toISOString() });
    const r = await pool.query(`SELECT free_practice FROM reviews WHERE item_id = $1`, [itemId]);
    expect(r.rows[0].free_practice).toBe(false);
  });

  it("rejects an unknown mode", async () => {
    const itemId = await insertItem();
    const res = await request(app)
      .post("/api/reviews")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: new Date().toISOString(), mode: "cram" });
    expect(res.status).toBe(400);
  });
});

describe("drill mode", () => {
  const post = (body: object) => request(app).post("/api/reviews").set("X-Passcode", PASSCODE).send(body);

  beforeEach(() => { vi.mocked(emitReviewLogged).mockClear(); });

  it("logs the review without touching review_state", async () => {
    const id = await insertItem();
    const due = new Date(Date.now() + 7 * 86_400_000);
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, total_reviews) VALUES ($1, 3, $2, 4)`, [id, due],
    );
    const res = await post({ item_id: id, result: "got_it", reviewed_at: new Date().toISOString(), mode: "drill" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: "drill", box: 3 });
    const rs = await pool.query(`SELECT box, next_review_at, total_reviews FROM review_state WHERE item_id = $1`, [id]);
    expect(rs.rows[0]).toMatchObject({ box: 3, total_reviews: 4 });
    expect(rs.rows[0].next_review_at.getTime()).toBe(due.getTime());
    const rv = await pool.query(`SELECT box_before, box_after, free_practice FROM reviews WHERE item_id = $1`, [id]);
    expect(rv.rows[0]).toEqual({ box_before: 3, box_after: 3, free_practice: true });
    await new Promise((r) => setTimeout(r, 25));
    expect(emitReviewLogged).not.toHaveBeenCalled();
  });

  it("a drilled brand-new card stays new", async () => {
    const id = await insertItem();
    const res = await post({ item_id: id, result: "missed", reviewed_at: new Date().toISOString(), mode: "drill" });
    expect(res.body).toEqual({ mode: "drill", box: 0 });
    const rs = await pool.query(`SELECT 1 FROM review_state WHERE item_id = $1`, [id]);
    expect(rs.rowCount).toBe(0);
  });

  it("a retried drill submit of a never-studied card is idempotent", async () => {
    const id = await insertItem();
    const body = { item_id: id, result: "got_it", reviewed_at: new Date().toISOString(), mode: "drill" };
    await post(body).expect(200);
    const again = await post(body);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ mode: "drill", box: 0 });
    const rv = await pool.query(`SELECT count(*)::int AS c FROM reviews WHERE item_id = $1`, [id]);
    expect(rv.rows[0].c).toBe(1);
  });

  // A drill is practice: it extends the streak, so when it is the day's first
  // review it is also the moment a streak milestone is reached. Skipping
  // detection there would drop the milestone silently — later scheduled
  // reviews are no longer "first of today".
  it("a drill that is the day's first review still reports a streak milestone", async () => {
    vi.mocked(emitMilestone).mockClear();
    const id = await insertItem();
    for (let d = 1; d <= 6; d++) {
      await pool.query(
        `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
         VALUES ($1, now() - make_interval(days => $2), 'got_it', 1, 2)`, [id, d],
      );
    }
    await post({ item_id: id, result: "got_it", reviewed_at: new Date().toISOString(), mode: "drill", tz: "UTC" })
      .expect(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(emitMilestone).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitMilestone).mock.calls[0]![0]).toMatchObject({ milestone_type: "streak", streak_days: 7 });
    expect(emitReviewLogged).not.toHaveBeenCalled();
  });

  it("an explicit scheduled mode schedules normally", async () => {
    const id = await insertItem();
    const res = await post({ item_id: id, result: "got_it", reviewed_at: new Date().toISOString(), mode: "scheduled" });
    expect(res.body.box).toBe(1);
    const rv = await pool.query(`SELECT free_practice FROM reviews WHERE item_id = $1`, [id]);
    expect(rv.rows[0].free_practice).toBe(false);
  });
});
