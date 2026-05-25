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

  it("returns all five skill groups, empty when no items", async () => {
    const res = await request(app).get("/api/library").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    for (const s of ["vocab", "grammar", "reading", "conjugation", "particle"]) {
      expect(res.body.by_skill[s]).toEqual({ count: 0, avg_mastery: 0, items: [] });
    }
  });

  it("derives display fields and box-based mastery", async () => {
    await insertItem(
      "vocab",
      { sentence_ruby: "x", target: "友達", sentence_english: "x" },
      { reading: "ともだち", meaning: "friend" },
      5, // box 5 → mastery 1.0
    );
    const res = await request(app).get("/api/library").set("X-Passcode", PASSCODE);
    const vocab = res.body.by_skill.vocab;
    expect(vocab.count).toBe(1);
    expect(vocab.avg_mastery).toBeCloseTo(1.0, 5);
    expect(vocab.items[0]).toMatchObject({
      skill: "vocab",
      front: "友達",
      reading: "ともだち",
      meaning: "friend",
      mastery: 1,
    });
  });

  it("averages mastery across items including unseen (mastery 0)", async () => {
    await insertItem("grammar", { pattern: "～ながら", sentence_english: "x" }, { explanation: "while" }, 5);
    await insertItem("grammar", { pattern: "～てから", sentence_english: "x" }, { explanation: "after" }); // unseen
    const res = await request(app).get("/api/library").set("X-Passcode", PASSCODE);
    const grammar = res.body.by_skill.grammar;
    expect(grammar.count).toBe(2);
    expect(grammar.avg_mastery).toBeCloseTo(0.5, 5); // (1.0 + 0) / 2
  });
});
