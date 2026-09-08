import { pool } from "../db/pool.js";
import { generateKanjiMnemonic, toRubyHtml, computeCost, MODEL } from "@nihongo/gen";
import type { KanjiMnemonic } from "@nihongo/shared";

// Lazy per-character mnemonic cache. Generation is triggered by a learner
// opening the Mnemonic tab, so it costs about a cent only for the kanji they
// actually wanted help with.

export class KanjiNotFoundError extends Error {
  constructor(character: string) {
    super(`kanji not found: ${character}`);
    this.name = "KanjiNotFoundError";
  }
}

async function readCached(character: string): Promise<KanjiMnemonic | null> {
  const res = await pool.query<{ content: KanjiMnemonic }>(
    `SELECT content FROM kanji_mnemonics WHERE character = $1`,
    [character],
  );
  return res.rows[0]?.content ?? null;
}

type RefRow = { meanings: string[]; on_yomi: string[]; kun_yomi: string[] };

// Generate + store. Returns whatever row ends up in the table, so two callers
// racing on the same character both get the single stored mnemonic. Losing that
// race wastes a cent of tokens, which is cheaper than locking to prevent it.
async function generateAndStore(character: string): Promise<KanjiMnemonic> {
  const ref = await pool.query<RefRow>(
    `SELECT meanings, on_yomi, kun_yomi FROM kanji WHERE character = $1`,
    [character],
  );
  const row = ref.rows[0];
  if (!row) throw new KanjiNotFoundError(character);

  const { mnemonic, usage } = await generateKanjiMnemonic({
    character,
    meanings: row.meanings,
    on: row.on_yomi,
    kun: row.kun_yomi,
  });

  const readings = await Promise.all(
    mnemonic.readings.map(async (r) => ({
      type: r.type,
      reading: r.reading,
      sound_hook: r.sound_hook,
      scene: r.scene,
      sentence: {
        jp: r.sentence_japanese,
        jp_ruby: await toRubyHtml(r.sentence_japanese),
        en: r.sentence_english,
      },
      ...(r.note ? { note: r.note } : {}),
    })),
  );

  // `character` comes from the request, never from the model response — an
  // echoed wrong glyph must not become the cache key.
  const content: KanjiMnemonic = {
    character,
    meaning: mnemonic.meaning,
    readings,
    recap: mnemonic.recap,
  };

  await pool.query(
    `INSERT INTO kanji_mnemonics (character, content, model, cost_usd)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (character) DO NOTHING`,
    [character, JSON.stringify(content), MODEL, computeCost(usage)],
  );

  const stored = await readCached(character);
  return stored ?? content;
}

// The cached mnemonic or nothing — never generates. The card view asks with
// this so opening a kanji card costs nothing; the learner decides whether to
// spend by tapping Write one.
export async function getCachedKanjiMnemonic(character: string): Promise<KanjiMnemonic | null> {
  return readCached(character);
}

export async function getKanjiMnemonic(character: string): Promise<KanjiMnemonic> {
  const cached = await readCached(character);
  if (cached) return cached;
  return generateAndStore(character);
}

// Deletes first, so a regeneration that fails leaves no mnemonic rather than a
// stale one the learner already rejected — the next open tries again.
export async function regenerateKanjiMnemonic(character: string): Promise<KanjiMnemonic> {
  await pool.query(`DELETE FROM kanji_mnemonics WHERE character = $1`, [character]);
  return generateAndStore(character);
}
