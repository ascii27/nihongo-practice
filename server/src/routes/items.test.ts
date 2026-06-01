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
