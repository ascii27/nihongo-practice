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

async function insertItem(opts: {
  external_id?: string;
  skill?: string;
  box?: number;
  nextReviewMinutesAgo?: number;
}) {
  const itemRes = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ($1, $2, $3, 'seed', $4) RETURNING id`,
    [
      opts.skill ?? "vocab",
      JSON.stringify({ sentence_ruby: "x", target: "x", sentence_english: "x" }),
      JSON.stringify({ meaning: "y", reading: "y" }),
      opts.external_id ?? null,
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

  it("caps the due queue at the remaining daily budget", async () => {
    for (let i = 0; i < 35; i++) await insertItem({ external_id: `due-${i}`, box: 1, nextReviewMinutesAgo: i + 1 });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.body.due).toHaveLength(30); // default daily target, no new cards to compete for the cap
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

describe("queue sizing follows the daily target", () => {
  it("serves 10 new + 20 due at the default target of 30", async () => {
    for (let i = 0; i < 40; i++) await insertItem({ skill: "vocab" }); // new
    for (let i = 0; i < 40; i++) await insertItem({ skill: "grammar", box: 1, nextReviewMinutesAgo: 30 }); // due

    const res = await request(app).get("/api/queue?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.new).toHaveLength(10);
    expect(res.body.due).toHaveLength(20);
  });

  it("scales with a raised target", async () => {
    await pool.query(`UPDATE app_settings SET daily_review_target = 60`);
    for (let i = 0; i < 40; i++) await insertItem({ skill: "vocab" });
    for (let i = 0; i < 60; i++) await insertItem({ skill: "grammar", box: 1, nextReviewMinutesAgo: 30 });

    const res = await request(app).get("/api/queue?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.new).toHaveLength(20); // round(60/3)
    expect(res.body.due).toHaveLength(40); // 60 − 20
  });

  it("lets due fill the whole cap when no new cards exist", async () => {
    for (let i = 0; i < 40; i++) await insertItem({ skill: "grammar", box: 1, nextReviewMinutesAgo: 30 });
    const res = await request(app).get("/api/queue?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.new).toHaveLength(0);
    expect(res.body.due).toHaveLength(30);
  });

  it("returns an empty queue once the target is met", async () => {
    const id = await insertItem({ skill: "vocab", box: 1, nextReviewMinutesAgo: 30 });
    for (let i = 0; i < 30; i++) {
      await pool.query(
        `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
         VALUES ($1, now(), 'got_it', 1, 2)`, [id],
      );
    }
    for (let i = 0; i < 20; i++) await insertItem({ skill: "grammar", box: 1, nextReviewMinutesAgo: 30 });

    const res = await request(app).get("/api/queue?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.due).toHaveLength(0);
    expect(res.body.new).toHaveLength(0);
  });

  it("shrinks the session to what remains", async () => {
    const id = await insertItem({ skill: "vocab", box: 1, nextReviewMinutesAgo: 30 });
    for (let i = 0; i < 25; i++) {
      await pool.query(
        `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
         VALUES ($1, now(), 'got_it', 2, 3)`, [id],
      );
    }
    for (let i = 0; i < 40; i++) await insertItem({ skill: "grammar", box: 1, nextReviewMinutesAgo: 30 });

    const res = await request(app).get("/api/queue?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.due.length + res.body.new.length).toBe(5);
  });

  it("spends the new-card budget globally, not per skill", async () => {
    for (let i = 0; i < 20; i++) await insertItem({ skill: "vocab" });
    for (let i = 0; i < 20; i++) await insertItem({ skill: "grammar" });

    // Introduce 10 new vocab cards, exhausting the global new budget.
    const vocab = await request(app).get("/api/queue?skill=vocab&tz=UTC").set("X-Passcode", PASSCODE);
    expect(vocab.body.new).toHaveLength(10);
    for (const item of vocab.body.new) {
      await pool.query(
        `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
         VALUES ($1, now(), 'got_it', 0, 1)`, [item.id],
      );
    }

    // Grammar must now get zero new cards — the budget is shared, not per skill.
    const grammar = await request(app).get("/api/queue?skill=grammar&tz=UTC").set("X-Passcode", PASSCODE);
    expect(grammar.body.new).toHaveLength(0);
  });
});

// Free practice — what a skill row on Today deals. Deliberately outside the
// daily budget: the target governs the day's plan, not whether the owner is
// allowed to drill a skill.
describe("free practice (?free=1)", () => {
  async function spendTheBudget(count = 30) {
    const id = await insertItem({ box: 1, nextReviewMinutesAgo: 30 });
    for (let i = 0; i < count; i++) {
      await pool.query(
        `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
         VALUES ($1, now(), 'got_it', 1::smallint, 2::smallint)`,
        [id],
      );
    }
  }

  it("serves cards when the budgeted queue is exhausted", async () => {
    await spendTheBudget();
    for (let i = 0; i < 25; i++) await insertItem({ skill: "kanji", box: 1, nextReviewMinutesAgo: 30 });

    const budgeted = await request(app).get("/api/queue?skill=kanji&tz=UTC").set("X-Passcode", PASSCODE);
    expect(budgeted.body.due.length + budgeted.body.new.length).toBe(0);

    const free = await request(app).get("/api/queue?skill=kanji&free=1&tz=UTC").set("X-Passcode", PASSCODE);
    expect(free.body.due.length + free.body.new.length).toBe(20);
  });

  it("caps the session at 20 regardless of the daily target", async () => {
    await pool.query(`UPDATE app_settings SET daily_review_target = 100`);
    for (let i = 0; i < 60; i++) await insertItem({ skill: "vocab", box: 1, nextReviewMinutesAgo: 30 });

    const res = await request(app).get("/api/queue?skill=vocab&free=1&tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.due.length + res.body.new.length).toBe(20);
  });

  it("leads with due cards and tops up with new", async () => {
    for (let i = 0; i < 6; i++) await insertItem({ skill: "vocab", box: 1, nextReviewMinutesAgo: 30 });
    for (let i = 0; i < 50; i++) await insertItem({ skill: "vocab" });

    const res = await request(app).get("/api/queue?skill=vocab&free=1&tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.due).toHaveLength(6);
    expect(res.body.new).toHaveLength(14);
  });

  it("ignores the new-card pacing limit", async () => {
    for (let i = 0; i < 40; i++) await insertItem({ skill: "explain" });

    // Spend the day's new-card share through ordinary practice first.
    const introduced = await request(app).get("/api/queue?tz=UTC").set("X-Passcode", PASSCODE);
    expect(introduced.body.new).toHaveLength(10);
    for (const item of introduced.body.new) {
      await pool.query(
        `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
         VALUES ($1, now(), 'got_it', 0::smallint, 1::smallint)`,
        [item.id],
      );
    }

    // The budgeted queue now refuses new cards; free practice still deals them.
    const budgeted = await request(app).get("/api/queue?skill=explain&tz=UTC").set("X-Passcode", PASSCODE);
    expect(budgeted.body.new).toHaveLength(0);

    const free = await request(app).get("/api/queue?skill=explain&free=1&tz=UTC").set("X-Passcode", PASSCODE);
    expect(free.body.new).toHaveLength(20);
  });

  it("still returns nothing for a skill with no cards at all", async () => {
    for (let i = 0; i < 10; i++) await insertItem({ skill: "vocab" });
    const res = await request(app).get("/api/queue?skill=listening&free=1&tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.due).toHaveLength(0);
    expect(res.body.new).toHaveLength(0);
  });

  it("does not affect the budgeted queue's own sizing", async () => {
    for (let i = 0; i < 40; i++) await insertItem({ skill: "vocab" });
    for (let i = 0; i < 40; i++) await insertItem({ skill: "grammar", box: 1, nextReviewMinutesAgo: 30 });

    const res = await request(app).get("/api/queue?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.new).toHaveLength(10);
    expect(res.body.due).toHaveLength(20);
  });
});
