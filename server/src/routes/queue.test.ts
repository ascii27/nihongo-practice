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

describe("GET /api/queue", () => {
  it("requires passcode", async () => {
    const res = await request(app).get("/api/queue");
    expect(res.status).toBe(401);
  });

  it("returns due items ordered by next_review_at ASC", async () => {
    const a = await insertItem({ external_id: "a", box: 1, nextReviewMinutesAgo: 30 });
    const b = await insertItem({ external_id: "b", box: 1, nextReviewMinutesAgo: 60 });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.due.map((i: { id: string }) => i.id)).toEqual([b, a]);
  });

  it("includes new items only when due.length < 10", async () => {
    // 5 due, 3 new → both populated
    for (let i = 0; i < 5; i++) await insertItem({ external_id: `due-${i}`, box: 1, nextReviewMinutesAgo: i + 1 });
    for (let i = 0; i < 3; i++) await insertItem({ external_id: `new-${i}` });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.due).toHaveLength(5);
    expect(res.body.new).toHaveLength(3);
  });

  it("does NOT include new items when due.length >= 10", async () => {
    for (let i = 0; i < 10; i++) await insertItem({ external_id: `due-${i}`, box: 1, nextReviewMinutesAgo: i + 1 });
    for (let i = 0; i < 3; i++) await insertItem({ external_id: `new-${i}` });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.body.due).toHaveLength(10);
    expect(res.body.new).toHaveLength(0);
  });

  it("caps new items at 10", async () => {
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

  it("rejects non-vocab skill filter with 400", async () => {
    const res = await request(app).get("/api/queue?skill=grammar").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(400);
  });
});
