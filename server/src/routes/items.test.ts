import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { itemsRouter } from "./items.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/items", itemsRouter));

beforeEach(async () => {
  await resetDb();
  process.env.NIHONGO_FAKE_AI = "1";
});
afterEach(() => {
  delete process.env.NIHONGO_FAKE_AI;
});

describe("POST /api/items/manual/translate", () => {
  it("requires passcode", async () => {
    const res = await request(app).post("/api/items/manual/translate").send({ input: "cat" });
    expect(res.status).toBe(401);
  });

  it("rejects empty input with 400", async () => {
    const res = await request(app)
      .post("/api/items/manual/translate")
      .set("X-Passcode", PASSCODE)
      .send({ input: "" });
    expect(res.status).toBe(400);
  });

  it("returns the AI's preview without writing to the DB", async () => {
    const res = await request(app)
      .post("/api/items/manual/translate")
      .set("X-Passcode", PASSCODE)
      .send({ input: "test" });
    expect(res.status).toBe(200);
    // Fake AI returns a deterministic stub.
    expect(res.body).toMatchObject({
      japanese: "テスト",
      english: "test",
      sentence_japanese: "これはテストです。",
      sentence_english: "This is a test.",
    });
    expect(typeof res.body.cost_usd).toBe("number");
    // No DB write yet.
    const count = await pool.query("SELECT count(*)::int AS c FROM items");
    expect(count.rows[0].c).toBe(0);
  });
});

describe("POST /api/items/manual", () => {
  it("requires passcode", async () => {
    const res = await request(app).post("/api/items/manual").send({
      japanese: "猫", english: "cat", sentence_japanese: "猫が好き。", sentence_english: "I like cats.",
    });
    expect(res.status).toBe(401);
  });

  it("rejects missing fields with 400", async () => {
    const res = await request(app)
      .post("/api/items/manual")
      .set("X-Passcode", PASSCODE)
      .send({ japanese: "x" });
    expect(res.status).toBe(400);
  });

  it("inserts a vocab item with source='user' and the expected display shape", async () => {
    const res = await request(app)
      .post("/api/items/manual")
      .set("X-Passcode", PASSCODE)
      .send({
        japanese: "猫",
        english: "cat",
        sentence_japanese: "猫が好きです。",
        sentence_english: "I like cats.",
      });
    expect(res.status).toBe(201);
    expect(res.body.item.skill).toBe("vocab");
    expect(res.body.item.source).toBe("user");
    expect(res.body.item.external_id).toMatch(/^user-/);
    expect(res.body.item.prompt.target).toBe("猫");
    expect(res.body.item.prompt.sentence_english).toBe("I like cats.");
    expect(res.body.item.answer.meaning).toBe("cat");
    expect(typeof res.body.item.answer.reading).toBe("string");
    // sentence_ruby should at least contain the input; furigana annotation is
    // best-effort via kuromoji.
    expect(res.body.item.prompt.sentence_ruby).toContain("猫");

    const stored = await pool.query("SELECT skill, source FROM items WHERE id=$1", [res.body.item.id]);
    expect(stored.rows[0]).toEqual({ skill: "vocab", source: "user" });
  });

  it("the new item has no review_state — it lands in the 'new' pool", async () => {
    const res = await request(app)
      .post("/api/items/manual")
      .set("X-Passcode", PASSCODE)
      .send({
        japanese: "走る", english: "to run",
        sentence_japanese: "毎日走ります。", sentence_english: "I run every day.",
      });
    const rs = await pool.query("SELECT count(*)::int AS c FROM review_state WHERE item_id=$1", [res.body.item.id]);
    expect(rs.rows[0].c).toBe(0);
  });
});

describe("GET /api/items/:id", () => {
  async function insertItem(skill: string, prompt: object, answer: object): Promise<string> {
    const r = await pool.query(
      `INSERT INTO items (skill, prompt, answer, source, external_id)
       VALUES ($1, $2, $3, 'seed', $4) RETURNING id`,
      [skill, JSON.stringify(prompt), JSON.stringify(answer), `e-${Math.random()}`],
    );
    return r.rows[0].id;
  }

  it("requires passcode", async () => {
    const id = await insertItem("vocab", { target: "猫" }, { meaning: "cat", reading: "ねこ" });
    const res = await request(app).get(`/api/items/${id}`);
    expect(res.status).toBe(401);
  });

  it("404s for an unknown id", async () => {
    const res = await request(app)
      .get("/api/items/00000000-0000-0000-0000-000000000000")
      .set("X-Passcode", PASSCODE);
    expect(res.status).toBe(404);
  });

  it("404s for a non-uuid id instead of erroring on the cast", async () => {
    const res = await request(app).get("/api/items/not-a-uuid").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(404);
  });

  it("returns the raw card plus Browse's display fields", async () => {
    const id = await insertItem(
      "vocab",
      { sentence_ruby: "猫が好きです。", target: "猫", sentence_english: "I like cats." },
      { meaning: "cat", reading: "ねこ" },
    );
    const res = await request(app).get(`/api/items/${id}`).set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      skill: "vocab",
      front: "猫",
      reading: "ねこ",
      meaning: "cat",
      source: "seed",
    });
    // The whole card, so the client can render both faces per skill.
    expect(res.body.prompt.sentence_english).toBe("I like cats.");
    expect(res.body.answer.meaning).toBe("cat");
  });

  it("reports an unstudied card as box null with zero counts", async () => {
    const id = await insertItem("vocab", { target: "水" }, { meaning: "water", reading: "みず" });
    const res = await request(app).get(`/api/items/${id}`).set("X-Passcode", PASSCODE);
    expect(res.body).toMatchObject({
      box: null,
      mastery: 0,
      total_reviews: 0,
      total_missed: 0,
      next_review_at: null,
      last_reviewed_at: null,
    });
  });

  it("carries the card's Leitner state once it has been studied", async () => {
    const id = await insertItem("kanji", { character: "水" }, { meanings: ["water"], on: ["スイ"], kun: ["みず"], stroke_count: 4 });
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, last_reviewed_at, total_reviews, total_missed)
       VALUES ($1, 4, now(), now(), 7, 2)`,
      [id],
    );
    const res = await request(app).get(`/api/items/${id}`).set("X-Passcode", PASSCODE);
    expect(res.body).toMatchObject({
      skill: "kanji",
      front: "水",
      box: 4,
      total_reviews: 7,
      total_missed: 2,
    });
    expect(res.body.mastery).toBeCloseTo(0.8, 5);
    expect(typeof res.body.next_review_at).toBe("string");
    expect(typeof res.body.last_reviewed_at).toBe("string");
  });
});
