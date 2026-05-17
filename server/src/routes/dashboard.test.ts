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
});
