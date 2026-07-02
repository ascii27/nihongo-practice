import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { queueRouter } from "./queue.js";

const PASSCODE = "test-passcode";

const app = makeTestApp(PASSCODE, (a) => {
  a.use("/api/queue", queueRouter);
});

beforeAll(async () => {
  // schema already migrated by db:migrate before tests run
});

beforeEach(async () => {
  await resetDb();
});

async function insertItem(opts: { external_id: string; box?: number; nextReviewMinutesAgo?: number }) {
  const itemRes = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ('vocab', $1, $2, 'seed', $3) RETURNING id`,
    [
      JSON.stringify({ sentence_ruby: "x", target: "x", sentence_english: "x" }),
      JSON.stringify({ meaning: "y", reading: "y" }),
      opts.external_id,
    ],
  );
  const id = itemRes.rows[0].id as string;
  if (opts.box !== undefined) {
    const t = new Date(Date.now() - (opts.nextReviewMinutesAgo ?? 0) * 60_000);
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, total_reviews)
       VALUES ($1, $2, $3, 0)`,
      [id, opts.box, t.toISOString()],
    );
  }
  return id;
}

async function recordNewExposureToday(itemId: string) {
  await pool.query(
    `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
     VALUES ($1, now(), 'got_it', 0, 1)`,
    [itemId],
  );
}

describe("GET /api/queue", () => {
  it("requires passcode", async () => {
    const res = await request(app).get("/api/queue");
    expect(res.status).toBe(401);
  });

  it("returns all currently-due items (order not significant)", async () => {
    const a = await insertItem({ external_id: "a", box: 1, nextReviewMinutesAgo: 30 });
    const b = await insertItem({ external_id: "b", box: 1, nextReviewMinutesAgo: 60 });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    const ids = res.body.due.map((i: { id: string }) => i.id);
    expect(new Set(ids)).toEqual(new Set([a, b]));
  });

  it("serves both due and new items", async () => {
    for (let i = 0; i < 5; i++) await insertItem({ external_id: `due-${i}`, box: 1, nextReviewMinutesAgo: i + 1 });
    for (let i = 0; i < 3; i++) await insertItem({ external_id: `new-${i}` });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.due).toHaveLength(5);
    expect(res.body.new).toHaveLength(3);
  });

  it("serves new items even when the due backlog is large", async () => {
    for (let i = 0; i < 12; i++) await insertItem({ external_id: `due-${i}`, box: 1, nextReviewMinutesAgo: i + 1 });
    for (let i = 0; i < 3; i++) await insertItem({ external_id: `new-${i}` });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.body.new).toHaveLength(3);
  });

  it("serves up to 10 new items per day", async () => {
    for (let i = 0; i < 25; i++) await insertItem({ external_id: `new-${i}` });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.body.due).toHaveLength(0);
    expect(res.body.new).toHaveLength(10);
  });

  it("excludes items not yet due", async () => {
    await insertItem({ external_id: "future", box: 2, nextReviewMinutesAgo: -60 }); // 60min in future
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.body.due).toHaveLength(0);
    expect(res.body.new).toHaveLength(0);
  });

  it("accepts grammar skill filter", async () => {
    const res = await request(app).get("/api/queue?skill=grammar").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
  });

  it("accepts explain skill filter", async () => {
    const res = await request(app).get("/api/queue?skill=explain").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
  });

  it("rejects unsupported skill with 400", async () => {
    const res = await request(app).get("/api/queue?skill=unknown").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(400);
  });

  it("counts new items introduced today against the daily cap", async () => {
    // 4 already introduced today -> only 6 of the 25 fresh items should be served
    for (let i = 0; i < 4; i++) {
      const id = await insertItem({ external_id: `seen-${i}`, box: 1, nextReviewMinutesAgo: 120 });
      await recordNewExposureToday(id);
    }
    for (let i = 0; i < 25; i++) await insertItem({ external_id: `fresh-${i}` });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.body.new).toHaveLength(6);
  });

  it("excludes suspended items from the due queue", async () => {
    const live = await insertItem({ external_id: "live", box: 1, nextReviewMinutesAgo: 30 });
    const dead = await insertItem({ external_id: "dead", box: 1, nextReviewMinutesAgo: 30 });
    await pool.query(`UPDATE review_state SET suspended = true WHERE item_id = $1`, [dead]);
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    const ids = res.body.due.map((i: { id: string }) => i.id);
    expect(ids).toContain(live);
    expect(ids).not.toContain(dead);
  });

  it("caps the due queue at 20", async () => {
    for (let i = 0; i < 25; i++) await insertItem({ external_id: `due-${i}`, box: 1, nextReviewMinutesAgo: i + 1 });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.body.due).toHaveLength(20);
  });

  it("counts items introduced today against the cap with a skill filter and non-UTC tz", async () => {
    const seen = await insertItem({ external_id: "seen-tz", box: 1, nextReviewMinutesAgo: 120 });
    await recordNewExposureToday(seen);
    for (let i = 0; i < 12; i++) await insertItem({ external_id: `fresh-tz-${i}` });
    const res = await request(app)
      .get("/api/queue?skill=vocab&tz=America/New_York")
      .set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.new).toHaveLength(9);
  });
});
