import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { studyListsRouter } from "./study-lists.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/study-lists", studyListsRouter));

function auth(r: request.Test): request.Test {
  return r.set("X-Passcode", PASSCODE);
}

async function insertVocab(target: string, meaning: string): Promise<string> {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ('vocab', $1, $2, 'seed', $3) RETURNING id`,
    [
      JSON.stringify({ sentence_ruby: target, target, sentence_english: meaning }),
      JSON.stringify({ meaning, reading: "x" }),
      `e-${Math.random()}`,
    ],
  );
  return r.rows[0].id;
}

async function createList(title = "Class Week 5"): Promise<string> {
  const res = await auth(request(app).post("/api/study-lists")).send({ title });
  expect(res.status).toBe(201);
  return res.body.id;
}

beforeEach(async () => {
  await resetDb();
  process.env.NIHONGO_FAKE_AI = "1";
});
afterEach(() => {
  delete process.env.NIHONGO_FAKE_AI;
});

describe("study-lists CRUD", () => {
  it("requires passcode", async () => {
    const res = await request(app).get("/api/study-lists");
    expect(res.status).toBe(401);
  });

  it("creates, lists, and deletes a list", async () => {
    const id = await createList();
    const list = await auth(request(app).get("/api/study-lists"));
    expect(list.body.study_lists).toHaveLength(1);
    expect(list.body.study_lists[0]).toMatchObject({ id, title: "Class Week 5", item_count: 0 });

    const del = await auth(request(app).delete(`/api/study-lists/${id}`));
    expect(del.status).toBe(204);
    const after = await auth(request(app).get("/api/study-lists"));
    expect(after.body.study_lists).toHaveLength(0);
  });

  it("404s detail for an unknown list", async () => {
    const res = await auth(request(app).get("/api/study-lists/00000000-0000-0000-0000-000000000000"));
    expect(res.status).toBe(404);
  });
});

describe("study-list membership", () => {
  it("adds an existing item, dedupes, and shows display rows", async () => {
    const id = await createList();
    const itemId = await insertVocab("水", "water");

    const add = await auth(request(app).post(`/api/study-lists/${id}/items`)).send({ item_id: itemId });
    expect(add.status).toBe(201);
    // Adding the same item again is idempotent (200, not a duplicate).
    const again = await auth(request(app).post(`/api/study-lists/${id}/items`)).send({ item_id: itemId });
    expect(again.status).toBe(200);

    const detail = await auth(request(app).get(`/api/study-lists/${id}`));
    expect(detail.body.item_count).toBe(1);
    expect(detail.body.items).toHaveLength(1);
    expect(detail.body.items[0]).toMatchObject({ skill: "vocab", front: "水", meaning: "water" });
  });

  it("404s adding to a missing list or a missing item", async () => {
    const id = await createList();
    const badItem = await auth(request(app).post(`/api/study-lists/${id}/items`))
      .send({ item_id: "00000000-0000-0000-0000-000000000000" });
    expect(badItem.status).toBe(404);
    expect(badItem.body.code).toBe("ITEM_NOT_FOUND");
  });

  it("removes a member", async () => {
    const id = await createList();
    const itemId = await insertVocab("本", "book");
    await auth(request(app).post(`/api/study-lists/${id}/items`)).send({ item_id: itemId });
    const del = await auth(request(app).delete(`/api/study-lists/${id}/items/${itemId}`));
    expect(del.status).toBe(204);
    const detail = await auth(request(app).get(`/api/study-lists/${id}`));
    expect(detail.body.item_count).toBe(0);
  });
});

describe("preview (generate editable draft)", () => {
  it("generates vocab fields (translation + example) from an input", async () => {
    const res = await auth(request(app).post("/api/study-lists/preview"))
      .send({ kind: "vocab", input: "test" });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("vocab");
    // Fake AI returns a well-formed vocab item with an example sentence.
    expect(res.body.japanese).toBeTruthy();
    expect(res.body.sentence_japanese).toBeTruthy();
    expect(res.body.sentence_english).toBeTruthy();
  });

  it("generates grammar fields (explanation + example) from a pattern", async () => {
    const res = await auth(request(app).post("/api/study-lists/preview"))
      .send({ kind: "grammar", input: "〜てから" });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("grammar");
    expect(res.body.pattern).toBeTruthy();
    expect(res.body.explanation).toBeTruthy();
    expect(res.body.sentence_japanese).toBeTruthy();
  });

  it("fills kanji meaning + readings from the reference table", async () => {
    await pool.query(
      `INSERT INTO kanji (character, strokes, stroke_count, meanings, on_yomi, kun_yomi)
       VALUES ('食', '["a","b"]', 2, ARRAY['eat','food'], ARRAY['ショク'], ARRAY['た.べる'])`,
    );
    const res = await auth(request(app).post("/api/study-lists/preview"))
      .send({ kind: "kanji", input: "食" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "kanji", character: "食", meaning: "eat, food" });
    expect(res.body.readings).toContain("ショク");
  });
});

describe("quick-add (save edited draft)", () => {
  it("creates a vocab item with the edited sentence and adds it", async () => {
    const id = await createList();
    const res = await auth(request(app).post(`/api/study-lists/${id}/quick-add`))
      .send({ kind: "vocab", japanese: "学校", english: "school", sentence_japanese: "学校に行く。", sentence_english: "I go to school." });
    expect(res.status).toBe(201);
    expect(res.body.item_id).toBeTruthy();

    const detail = await auth(request(app).get(`/api/study-lists/${id}`));
    expect(detail.body.items[0]).toMatchObject({ skill: "vocab", front: "学校", meaning: "school" });
    const src = await pool.query(`SELECT source, prompt FROM items WHERE id = $1`, [res.body.item_id]);
    expect(src.rows[0].source).toBe("user");
    expect(src.rows[0].prompt.sentence_english).toBe("I go to school.");
  });

  it("creates a kanji item, keeping edited meaning but authoritative readings", async () => {
    await pool.query(
      `INSERT INTO kanji (character, strokes, stroke_count, meanings, on_yomi, kun_yomi)
       VALUES ('食', '["a","b"]', 2, ARRAY['eat'], ARRAY['ショク'], ARRAY['た.べる'])`,
    );
    const id = await createList();
    const res = await auth(request(app).post(`/api/study-lists/${id}/quick-add`))
      .send({ kind: "kanji", character: "食", meaning: "eat, to consume" });
    expect(res.status).toBe(201);
    const item = await pool.query(`SELECT skill, answer FROM items WHERE id = $1`, [res.body.item_id]);
    expect(item.rows[0].skill).toBe("kanji");
    expect(item.rows[0].answer).toMatchObject({ meanings: ["eat", "to consume"], on: ["ショク"], stroke_count: 2 });
  });

  it("creates a grammar item with an example sentence", async () => {
    const id = await createList();
    const res = await auth(request(app).post(`/api/study-lists/${id}/quick-add`))
      .send({ kind: "grammar", pattern: "〜てから", explanation: "after doing", sentence_japanese: "食べてから行く。", sentence_english: "Go after eating." });
    expect(res.status).toBe(201);
    const detail = await auth(request(app).get(`/api/study-lists/${id}`));
    expect(detail.body.items[0]).toMatchObject({ skill: "grammar", front: "〜てから" });
    const item = await pool.query(`SELECT prompt, answer FROM items WHERE id = $1`, [res.body.item_id]);
    expect(item.rows[0].answer.explanation).toBe("after doing");
    expect(item.rows[0].prompt.sentence_english).toBe("Go after eating.");
  });
});

describe("cram + candidates", () => {
  it("returns all members as review items ignoring schedule", async () => {
    const id = await createList();
    const a = await insertVocab("水", "water");
    const b = await insertVocab("火", "fire");
    // Suspend/schedule shouldn't matter for cram.
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at) VALUES ($1, 5, now() + interval '30 days')`,
      [a],
    );
    await auth(request(app).post(`/api/study-lists/${id}/items`)).send({ item_id: a });
    await auth(request(app).post(`/api/study-lists/${id}/items`)).send({ item_id: b });

    const cram = await auth(request(app).get(`/api/study-lists/${id}/cram`));
    expect(cram.status).toBe(200);
    expect(cram.body.items.map((i: { id: string }) => i.id).sort()).toEqual([a, b].sort());
  });

  it("searches candidates not already in the list", async () => {
    const id = await createList();
    const inList = await insertVocab("水", "water");
    await insertVocab("火", "fire water mix"); // matches 'water' by meaning, not in list
    await auth(request(app).post(`/api/study-lists/${id}/items`)).send({ item_id: inList });

    const res = await auth(request(app).get(`/api/study-lists/${id}/candidates?q=water`));
    expect(res.status).toBe(200);
    // The already-added 水 is excluded; the other match is returned.
    const fronts = res.body.items.map((i: { front: string }) => i.front);
    expect(fronts).toContain("火");
    expect(fronts).not.toContain("水");
  });
});
