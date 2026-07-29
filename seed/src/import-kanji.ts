import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import pg from "pg";
import { parseKanjiVg, parseKanjiDic } from "./kanji-parse.js";

// Import kanji stroke data (KanjiVG) + meanings/readings (KANJIDIC2) into the
// `kanji` reference table and a thin `kanji` item per character. Scoped to the
// jōyō set (KANJIDIC2 grade 1..8 ≈ 2,136 kanji). Idempotent: safe to re-run.
//
//   npm --workspace seed run import:kanji <kanjivg.xml[.gz]> <kanjidic2.xml[.gz]> [jlpt-kanji.csv]

function readMaybeGzip(path: string): string {
  const buf = readFileSync(path);
  if (path.endsWith(".gz")) return gunzipSync(buf).toString("utf8");
  return buf.toString("utf8");
}

// Optional character→JLPT-level map. CSV rows: "食,N4" (header row ignored).
function loadJlpt(path: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!path || !existsSync(path)) return map;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const [ch, level] = line.split(",").map((s) => s?.trim());
    if (!ch || !level || !/^N[1-5]$/.test(level)) continue;
    map.set(ch, level);
  }
  return map;
}

async function main() {
  const [, , vgPath, dicPath, jlptPath] = process.argv;
  if (!vgPath || !dicPath) {
    console.error("usage: tsx src/import-kanji.ts <kanjivg.xml[.gz]> <kanjidic2.xml[.gz]> [jlpt-kanji.csv]");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  console.log(`parsing KanjiVG (${vgPath})…`);
  const vg = parseKanjiVg(readMaybeGzip(vgPath));
  console.log(`parsing KANJIDIC2 (${dicPath})…`);
  const dic = parseKanjiDic(readMaybeGzip(dicPath));
  const jlpt = loadJlpt(jlptPath);
  console.log(`kanjivg=${vg.size} kanjidic=${dic.size} jlpt_map=${jlpt.size}`);

  // Scope: jōyō characters (grade 1..8) that we have stroke data for.
  const characters: string[] = [];
  for (const [ch, d] of dic) {
    if (d.grade != null && d.grade >= 1 && d.grade <= 8 && vg.has(ch)) characters.push(ch);
  }
  console.log(`importing ${characters.length} jōyō kanji`);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let refUpserts = 0;
  let itemInserts = 0;
  try {
    await client.query("BEGIN");
    for (const ch of characters) {
      const strokes = vg.get(ch)!;
      const d = dic.get(ch)!;
      const level = jlpt.get(ch) ?? null;

      await client.query(
        `INSERT INTO kanji (character, strokes, stroke_count, radical, meanings, on_yomi, kun_yomi, grade, jlpt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (character) DO UPDATE SET
           strokes = EXCLUDED.strokes, stroke_count = EXCLUDED.stroke_count,
           radical = EXCLUDED.radical, meanings = EXCLUDED.meanings,
           on_yomi = EXCLUDED.on_yomi, kun_yomi = EXCLUDED.kun_yomi,
           grade = EXCLUDED.grade, jlpt = EXCLUDED.jlpt`,
        [
          ch,
          JSON.stringify(strokes.strokes),
          strokes.strokes.length,
          strokes.radical,
          d.meanings,
          d.on,
          d.kun,
          d.grade,
          level,
        ],
      );
      refUpserts += 1;

      const prompt = { character: ch };
      const answer = { meanings: d.meanings, on: d.on, kun: d.kun, stroke_count: strokes.strokes.length };
      const ins = await client.query(
        `INSERT INTO items (skill, prompt, answer, source, external_id)
         VALUES ('kanji', $1, $2, 'seed', $3)
         ON CONFLICT (source, external_id) DO NOTHING`,
        [JSON.stringify(prompt), JSON.stringify(answer), ch],
      );
      if ((ins.rowCount ?? 0) > 0) itemInserts += 1;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log(`done. kanji rows upserted=${refUpserts}, new items inserted=${itemInserts} (skipped=${characters.length - itemInserts})`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
