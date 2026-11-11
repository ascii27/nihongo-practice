import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { libraryRouter } from "./library.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/library", libraryRouter));

async function insertItem(
  skill: string,
  prompt: object,
  answer: object,
  box?: number,
): Promise<string> {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ($1, $2, $3, 'seed', $4) RETURNING id`,
    [skill, JSON.stringify(prompt), JSON.stringify(answer), `e-${Math.random()}`],
  );
  const id = r.rows[0].id;
  if (box !== undefined) {
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at) VALUES ($1, $2, now())`,
      [id, box],
    );
  }
  return id;
}

beforeEach(() => resetDb());

describe("GET /api/library", () => {
  it("requires passcode", async () => {
    const res = await request(app).get("/api/library");
    expect(res.status).toBe(401);
  });

  const get = (qs = "") => request(app).get(`/api/library${qs}`).set("X-Passcode", PASSCODE);
  const vocab = (target: string, meaning: string) =>
    insertItem("vocab", { sentence_ruby: target, target, sentence_english: meaning }, { reading: "x", meaning });
  async function tag(name: string, itemIds: string[]): Promise<string> {
    const id = (await pool.query(`INSERT INTO tags (name) VALUES ($1) RETURNING id`, [name])).rows[0].id;
    for (const itemId of itemIds) {
      await pool.query(`INSERT INTO item_tags (tag_id, item_id) VALUES ($1, $2)`, [id, itemId]);
    }
    return id;
  }

  it("is an empty page when there are no items", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], total: 0, next_offset: null });
  });

  it("derives display fields and box-based mastery", async () => {
    await insertItem(
      "vocab",
      { sentence_ruby: "x", target: "友達", sentence_english: "x" },
      { reading: "ともだち", meaning: "friend" },
      5, // box 5 → mastery 1.0
    );
    const res = await get();
    expect(res.body.items[0]).toMatchObject({
      skill: "vocab", front: "友達", reading: "ともだち", meaning: "friend", mastery: 1, user_tags: [],
    });
  });

  it("pages 50 at a time with next_offset", async () => {
    await pool.query(
      `INSERT INTO items (skill, prompt, answer, source)
       SELECT 'vocab', jsonb_build_object('sentence_ruby','w','target','語'||g,'sentence_english','w'),
              '{"meaning":"m","reading":"r"}', 'seed' FROM generate_series(1, 55) g`,
    );
    const p1 = await get();
    expect(p1.body.items).toHaveLength(50);
    expect(p1.body.total).toBe(55);
    expect(p1.body.next_offset).toBe(50);
    const p2 = await get("?offset=50");
    expect(p2.body.items).toHaveLength(5);
    expect(p2.body.next_offset).toBeNull();
    // Rows created in one statement share created_at; paging must still be a
    // stable partition — every card exactly once across the two pages.
    const seen = new Set([...p1.body.items, ...p2.body.items].map((i: { id: string }) => i.id));
    expect(seen.size).toBe(55);
    const past = await get("?offset=500");
    expect(past.body.items).toEqual([]);
    expect(past.body.next_offset).toBeNull();
  });

  it("breaks created_at ties by id so paging is a stable order", async () => {
    await pool.query(
      `INSERT INTO items (skill, prompt, answer, source, created_at)
       SELECT 'vocab', jsonb_build_object('target','語'||g), '{"meaning":"m"}', 'seed', '2026-01-01'
         FROM generate_series(1, 8) g`,
    );
    const r = await get();
    const ids = r.body.items.map((i: { id: string }) => i.id);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  it("filters by search, skill and tag and returns user_tags", async () => {
    const water = await vocab("水", "water");
    const fire = await vocab("火", "fire");
    await insertItem("grammar", { pattern: "water-ish", sentence_english: "x" }, { explanation: "x" });
    const coto = await tag("Coto Academy", [water]);
    await tag("Week 5", [water, fire]);
    const r = await get(`?q=WAT&skill=vocab&tag=${coto}`);
    expect(r.body.items.map((i: { id: string }) => i.id)).toEqual([water]);
    expect(r.body.items[0].user_tags.map((t: { name: string }) => t.name)).toEqual(["Coto Academy", "Week 5"]);
    expect(r.body.total).toBe(1);
  });

  it("orders a tag filter by most recently tagged", async () => {
    const a = await vocab("水", "water");
    const b = await vocab("火", "fire");
    const t = await tag("Coto Academy", []);
    await pool.query(`INSERT INTO item_tags (tag_id, item_id, added_at) VALUES ($1, $2, now() - interval '1 day')`, [t, b]);
    await pool.query(`INSERT INTO item_tags (tag_id, item_id, added_at) VALUES ($1, $2, now())`, [t, a]);
    const r = await get(`?tag=${t}`);
    expect(r.body.items.map((i: { id: string }) => i.id)).toEqual([a, b]);
  });

  it("404s an unknown tag and 400s an unsupported skill", async () => {
    expect((await get("?tag=00000000-0000-0000-0000-000000000000")).status).toBe(404);
    expect((await get("?skill=nope")).status).toBe(400);
  });
});
