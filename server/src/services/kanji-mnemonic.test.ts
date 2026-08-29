import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { pool } from "../db/pool.js";
import { resetDb } from "../db/reset.js";
import { getKanjiMnemonic, regenerateKanjiMnemonic, KanjiNotFoundError } from "./kanji-mnemonic.js";

async function insertShoku(): Promise<void> {
  await pool.query(
    `INSERT INTO kanji (character, strokes, stroke_count, meanings, on_yomi, kun_yomi)
     VALUES ('食', '["a"]', 1, ARRAY['eat','food'], ARRAY['ショク'], ARRAY['た.べる'])`,
  );
}

beforeEach(async () => {
  await resetDb();
  process.env.NIHONGO_FAKE_AI = "1";
});
afterEach(() => {
  delete process.env.NIHONGO_FAKE_AI;
});

describe("getKanjiMnemonic", () => {
  it("throws KanjiNotFoundError for a character not in the reference table", async () => {
    await expect(getKanjiMnemonic("猫")).rejects.toBeInstanceOf(KanjiNotFoundError);
  });

  it("generates, ruby-annotates and stores on a cache miss", async () => {
    await insertShoku();
    const m = await getKanjiMnemonic("食");

    expect(m.character).toBe("食");
    expect(m.readings.length).toBeGreaterThan(0);
    expect(m.readings[0].sentence.jp_ruby).toContain("<ruby>");
    expect(m.readings[0].sentence.jp_ruby).toContain("<rt>");

    const row = await pool.query(`SELECT content, model, cost_usd FROM kanji_mnemonics WHERE character = '食'`);
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].model.length).toBeGreaterThan(0);
    expect(Number(row.rows[0].cost_usd)).toBe(0); // fake AI reports zero usage
  });

  it("returns the cached row without regenerating", async () => {
    await insertShoku();
    await getKanjiMnemonic("食");
    await pool.query(
      `UPDATE kanji_mnemonics
          SET content = jsonb_set(content, '{meaning,gloss}', '"EDITED"')
        WHERE character = '食'`,
    );
    const again = await getKanjiMnemonic("食");
    expect(again.meaning.gloss).toBe("EDITED");
  });

  it("stores one row when two callers race", async () => {
    await insertShoku();
    const [a, b] = await Promise.all([getKanjiMnemonic("食"), getKanjiMnemonic("食")]);
    const count = await pool.query(`SELECT count(*)::int AS c FROM kanji_mnemonics WHERE character = '食'`);
    expect(count.rows[0].c).toBe(1);
    expect(a).toEqual(b);
  });
});

describe("regenerateKanjiMnemonic", () => {
  it("replaces the cached row", async () => {
    await insertShoku();
    await getKanjiMnemonic("食");
    await pool.query(
      `UPDATE kanji_mnemonics
          SET content = jsonb_set(content, '{meaning,gloss}', '"STALE"')
        WHERE character = '食'`,
    );
    const fresh = await regenerateKanjiMnemonic("食");
    expect(fresh.meaning.gloss).not.toBe("STALE");
    const count = await pool.query(`SELECT count(*)::int AS c FROM kanji_mnemonics WHERE character = '食'`);
    expect(count.rows[0].c).toBe(1);
  });

  it("throws KanjiNotFoundError for an unknown character", async () => {
    await expect(regenerateKanjiMnemonic("猫")).rejects.toBeInstanceOf(KanjiNotFoundError);
  });
});
