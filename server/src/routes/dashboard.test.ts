import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { dashboardRouter } from "./dashboard.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/dashboard", dashboardRouter));

async function insertItem(skill: string, opts: { nextReviewMinutesAgo?: number; box?: number } = {}) {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ($1, '{}'::jsonb, '{}'::jsonb, 'seed', $2) RETURNING id`,
    [skill, `e-${Math.random()}`],
  );
  const id = r.rows[0].id;
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

async function insertReview(itemId: string, boxBefore = 1, cram = false) {
  await pool.query(
    `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after, cram)
     VALUES ($1, now(), 'got_it', $2::smallint, $2::smallint + 1, $3)`,
    [itemId, boxBefore, cram],
  );
}

// An item already in the SRS and not due for a while: it is neither in the new
// pool nor the due pool, so it can carry today's review history without
// changing what a session would serve.
async function insertSettledItem(skill = "vocab") {
  return insertItem(skill, { box: 3, nextReviewMinutesAgo: -600 });
}

beforeEach(() => resetDb());

describe("GET /api/dashboard", () => {
  it("requires passcode", async () => {
    const res = await request(app).get("/api/dashboard");
    expect(res.status).toBe(401);
  });

  it("returns zero counts when no items exist", async () => {
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.streak_days).toBe(0);
    expect(res.body.last_practiced_at).toBeNull();
    for (const skill of ["vocab", "grammar", "reading", "conjugation", "particle"]) {
      expect(res.body.by_skill[skill]).toEqual({ due: 0, new: 0 });
    }
  });

  it("counts due + new items per skill", async () => {
    await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });   // due
    await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 60 });   // due
    await insertItem("vocab");                                          // new
    await insertItem("grammar", { box: 1, nextReviewMinutesAgo: 5 });  // due
    await insertItem("particle");                                       // new

    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.by_skill.vocab).toEqual({ due: 2, new: 1 });
    expect(res.body.by_skill.grammar).toEqual({ due: 1, new: 0 });
    expect(res.body.by_skill.particle).toEqual({ due: 0, new: 1 });
    expect(res.body.by_skill.reading).toEqual({ due: 0, new: 0 });
    expect(res.body.by_skill.conjugation).toEqual({ due: 0, new: 0 });
  });

  it("reports the actual count of new items (no NEW_CAP clamp)", async () => {
    // 15 unstudied vocab items — well past the previous cap of 10.
    for (let i = 0; i < 15; i++) await insertItem("vocab");
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.by_skill.vocab).toEqual({ due: 0, new: 15 });
  });

  it("returns last_practiced_at as the most recent review", async () => {
    const id = await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 60 });
    const earlier = new Date(Date.now() - 120 * 60_000).toISOString();
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    await pool.query(
      `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after) VALUES ($1, $2, 'got_it', 1, 2), ($1, $3, 'got_it', 2, 3)`,
      [id, earlier, recent],
    );
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(new Date(res.body.last_practiced_at).getTime()).toBe(new Date(recent).getTime());
  });

  it("includes a listening bucket", async () => {
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.by_skill).toHaveProperty("listening");
  });
});

describe("GET /api/dashboard — daily budget", () => {
  it("reports a full allowance when nothing has been reviewed", async () => {
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.daily_target).toBe(30);
    expect(res.body.reviewed_today).toBe(0);
    expect(res.body.remaining).toBe(30);
  });

  it("counts today's reviews against the allowance", async () => {
    const id = await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });
    await insertReview(id);
    await insertReview(id);
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.reviewed_today).toBe(2);
    expect(res.body.remaining).toBe(28);
  });

  it("reports remaining 0 once the target is met, regardless of backlog", async () => {
    const id = await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });
    for (let i = 0; i < 30; i++) await insertReview(id);
    // A large untouched backlog must not raise `remaining`.
    for (let i = 0; i < 40; i++) await insertItem("grammar");

    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.remaining).toBe(0);
    expect(res.body.reviewed_today).toBe(30);
    expect(res.body.by_skill.grammar.new).toBe(40);   // rows stay honest
  });

  it("accepts a tz and falls back to UTC on a bad one", async () => {
    const ok = await request(app).get("/api/dashboard?tz=Asia/Tokyo").set("X-Passcode", PASSCODE);
    expect(ok.status).toBe(200);
    const bad = await request(app).get("/api/dashboard?tz=Not/AZone").set("X-Passcode", PASSCODE);
    expect(bad.status).toBe(200);
    expect(bad.body.daily_target).toBe(30);
  });
});

// `session_size` is the promise the hero makes: exactly what the next mixed
// practice session will deal. It is not `min(remaining, pool)` — the new-card
// share constrains it too, and that is what the hero used to miss.
describe("GET /api/dashboard — session_size", () => {
  it("serves only the new-card share when the deck is nothing but new cards", async () => {
    for (let i = 0; i < 300; i++) await insertItem("vocab");
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.remaining).toBe(30);       // budget says 30…
    expect(res.body.by_skill.vocab.new).toBe(300);
    expect(res.body.session_size).toBe(10);    // …but the session deals 10
  });

  it("lets due cards fill the whole budget when no new cards remain", async () => {
    for (let i = 0; i < 300; i++) await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.session_size).toBe(30);
  });

  it("is bounded by thin pools on both sides", async () => {
    for (let i = 0; i < 3; i++) await insertItem("vocab");
    for (let i = 0; i < 2; i++) await insertItem("grammar", { box: 1, nextReviewMinutesAgo: 30 });
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.session_size).toBe(5);
  });

  it("takes new first, leaving due only the rest of the cap", async () => {
    for (let i = 0; i < 100; i++) await insertItem("vocab");
    for (let i = 0; i < 100; i++) await insertItem("grammar", { box: 1, nextReviewMinutesAgo: 30 });
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.session_size).toBe(30);   // 10 new + 20 due, not 40
  });

  it("is zero once the target is met, however large the backlog", async () => {
    const settled = await insertSettledItem();
    for (let i = 0; i < 30; i++) await insertReview(settled);
    for (let i = 0; i < 300; i++) await insertItem("vocab");
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.remaining).toBe(0);
    expect(res.body.session_size).toBe(0);
  });

  // The I1 bug: budget left, backlog left, but the new-card share is spent and
  // nothing is due, so the session would come back empty.
  it("is zero when the new share is spent and nothing is due", async () => {
    const settled = await insertSettledItem();
    for (let i = 0; i < 10; i++) await insertReview(settled, 0);   // 10 introduced today
    for (let i = 0; i < 300; i++) await insertItem("vocab");

    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.remaining).toBe(20);            // budget still says 20…
    expect(res.body.session_size).toBe(0);          // …and the session deals none
    expect(res.body.another_round_size).toBe(10);   // but a round would deal 10
  });

  it("excludes suspended items from both the due counts and the session", async () => {
    const id = await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });
    await pool.query(`UPDATE review_state SET suspended = true WHERE item_id = $1`, [id]);
    await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });

    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.by_skill.vocab.due).toBe(1);
    expect(res.body.session_size).toBe(1);
  });

  it("is not reduced by a cram, which costs no allowance", async () => {
    const settled = await insertSettledItem();
    for (let i = 0; i < 40; i++) await insertReview(settled, 1, true);   // crammed a 40-card list
    for (let i = 0; i < 300; i++) await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });

    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.reviewed_today).toBe(0);
    expect(res.body.session_size).toBe(30);
  });
});

describe("GET /api/dashboard — another_round_size", () => {
  it("reports what a round would deal when the target is met", async () => {
    const settled = await insertSettledItem();
    for (let i = 0; i < 30; i++) await insertReview(settled);
    for (let i = 0; i < 300; i++) await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });

    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.session_size).toBe(0);
    expect(res.body.another_round_size).toBe(30);
  });

  it("is zero when a round would deal nothing", async () => {
    // A big cram already introduced far more new cards than another round's
    // share would allow, and nothing is due — so unlocking would be a dead end.
    const settled = await insertSettledItem();
    for (let i = 0; i < 40; i++) await insertReview(settled, 0, true);
    for (let i = 0; i < 300; i++) await insertItem("vocab");

    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.remaining).toBe(30);
    expect(res.body.session_size).toBe(0);
    expect(res.body.another_round_size).toBe(0);
  });

  it("is zero when the deck is empty", async () => {
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.session_size).toBe(0);
    expect(res.body.another_round_size).toBe(0);
  });

  it("matches the session_size the round actually produces", async () => {
    const settled = await insertSettledItem();
    for (let i = 0; i < 30; i++) await insertReview(settled);
    for (let i = 0; i < 300; i++) await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });

    const before = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    const after = await request(app).post("/api/dashboard/round").set("X-Passcode", PASSCODE);
    expect(after.body.session_size).toBe(before.body.another_round_size);
  });
});

describe("POST /api/dashboard/round", () => {
  it("requires passcode", async () => {
    const res = await request(app).post("/api/dashboard/round");
    expect(res.status).toBe(401);
  });

  it("unlocks another full target and returns the fresh payload", async () => {
    const id = await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });
    for (let i = 0; i < 30; i++) await insertReview(id);
    expect((await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE)).body.remaining).toBe(0);

    const res = await request(app).post("/api/dashboard/round").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.remaining).toBe(30);
    expect(res.body.reviewed_today).toBe(30);
    expect(res.body.by_skill).toBeDefined();       // full dashboard payload, not a stub
    expect(res.body.streak_days).toBeDefined();
  });

  it("is repeatable", async () => {
    await request(app).post("/api/dashboard/round").set("X-Passcode", PASSCODE);
    const res = await request(app).post("/api/dashboard/round").set("X-Passcode", PASSCODE);
    expect(res.body.remaining).toBe(90);
  });
});
