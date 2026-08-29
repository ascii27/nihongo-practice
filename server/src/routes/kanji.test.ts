import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { kanjiRouter } from "./kanji.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/kanji", kanjiRouter));

async function insertKanji(k: {
  character: string;
  strokes: string[];
  radical?: string | null;
  meanings?: string[];
  on?: string[];
  kun?: string[];
  grade?: number | null;
  jlpt?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO kanji (character, strokes, stroke_count, radical, meanings, on_yomi, kun_yomi, grade, jlpt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      k.character,
      JSON.stringify(k.strokes),
      k.strokes.length,
      k.radical ?? null,
      k.meanings ?? [],
      k.on ?? [],
      k.kun ?? [],
      k.grade ?? null,
      k.jlpt ?? null,
    ],
  );
}

beforeEach(() => resetDb());

describe("GET /api/kanji", () => {
  it("requires passcode", async () => {
    const res = await request(app).get("/api/kanji");
    expect(res.status).toBe(401);
  });

  it("returns browse rows without stroke paths, ordered by grade then strokes", async () => {
    await insertKanji({ character: "食", strokes: ["a", "b"], meanings: ["eat"], grade: 2, jlpt: "N4" });
    await insertKanji({ character: "一", strokes: ["x"], meanings: ["one"], grade: 1, jlpt: "N5" });
    const res = await request(app).get("/api/kanji").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.kanji.map((k: { character: string }) => k.character)).toEqual(["一", "食"]);
    expect(res.body.kanji[0]).toEqual({ character: "一", meanings: ["one"], stroke_count: 1, jlpt: "N5" });
    expect(res.body.kanji[0].strokes).toBeUndefined();
  });

  it("filters by jlpt level", async () => {
    await insertKanji({ character: "食", strokes: ["a"], grade: 2, jlpt: "N4" });
    await insertKanji({ character: "一", strokes: ["x"], grade: 1, jlpt: "N5" });
    const res = await request(app).get("/api/kanji?jlpt=N5").set("X-Passcode", PASSCODE);
    expect(res.body.kanji.map((k: { character: string }) => k.character)).toEqual(["一"]);
  });

  it("searches by meaning substring", async () => {
    await insertKanji({ character: "食", strokes: ["a"], meanings: ["eat", "food"], grade: 2 });
    await insertKanji({ character: "一", strokes: ["x"], meanings: ["one"], grade: 1 });
    const res = await request(app).get("/api/kanji?q=food").set("X-Passcode", PASSCODE);
    expect(res.body.kanji.map((k: { character: string }) => k.character)).toEqual(["食"]);
  });
});

describe("GET /api/kanji/:character", () => {
  it("returns full detail including ordered stroke paths", async () => {
    await insertKanji({
      character: "食",
      strokes: ["s1", "s2", "s3"],
      radical: "人",
      meanings: ["eat", "food"],
      on: ["ショク"],
      kun: ["た.べる"],
      grade: 2,
      jlpt: "N4",
    });
    const res = await request(app).get("/api/kanji/食").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      character: "食",
      strokes: ["s1", "s2", "s3"],
      stroke_count: 3,
      radical: "人",
      meanings: ["eat", "food"],
      on: ["ショク"],
      kun: ["た.べる"],
      jlpt: "N4",
    });
  });

  it("404s for an unknown character", async () => {
    const res = await request(app).get("/api/kanji/龘").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("KANJI_NOT_FOUND");
  });
});

describe("kanji mnemonics", () => {
  beforeEach(() => { process.env.NIHONGO_FAKE_AI = "1"; });
  afterEach(() => { delete process.env.NIHONGO_FAKE_AI; });

  it("requires passcode", async () => {
    const res = await request(app).get("/api/kanji/%E9%A3%9F/mnemonic");
    expect(res.status).toBe(401);
  });

  it("returns a mnemonic with ruby-annotated sentences", async () => {
    await insertKanji({ character: "食", strokes: ["a"], meanings: ["eat"], on: ["ショク"], kun: ["た.べる"] });
    const res = await request(app)
      .get(`/api/kanji/${encodeURIComponent("食")}/mnemonic`)
      .set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.character).toBe("食");
    expect(res.body.meaning.hook.length).toBeGreaterThan(0);
    expect(res.body.readings[0].sentence.jp_ruby).toContain("<ruby>");
  });

  it("404s for a character with no reference row", async () => {
    const res = await request(app)
      .get(`/api/kanji/${encodeURIComponent("猫")}/mnemonic`)
      .set("X-Passcode", PASSCODE);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("KANJI_NOT_FOUND");
  });

  it("regenerate replaces the stored mnemonic", async () => {
    await insertKanji({ character: "食", strokes: ["a"], meanings: ["eat"], on: ["ショク"], kun: ["た.べる"] });
    await request(app).get(`/api/kanji/${encodeURIComponent("食")}/mnemonic`).set("X-Passcode", PASSCODE);
    await pool.query(
      `UPDATE kanji_mnemonics SET content = jsonb_set(content, '{meaning,gloss}', '"STALE"') WHERE character = '食'`,
    );
    const res = await request(app)
      .post(`/api/kanji/${encodeURIComponent("食")}/mnemonic/regenerate`)
      .set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.meaning.gloss).not.toBe("STALE");
  });

  it("still serves the plain detail route", async () => {
    await insertKanji({ character: "食", strokes: ["a", "b"], meanings: ["eat"] });
    const res = await request(app)
      .get(`/api/kanji/${encodeURIComponent("食")}`)
      .set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.strokes).toEqual(["a", "b"]);
  });
});
