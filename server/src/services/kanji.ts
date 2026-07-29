import { pool } from "../db/pool.js";
import type { KanjiBrowseItem, KanjiDetail } from "@nihongo/shared";

type BrowseRow = {
  character: string;
  meanings: string[];
  stroke_count: number;
  jlpt: string | null;
};

// Browse/search the kanji reference table. Optional filters: jlpt level, jōyō
// grade, and a substring `q` matched against the character or its meanings.
export async function browseKanji(opts: {
  jlpt?: string;
  grade?: number;
  q?: string;
}): Promise<KanjiBrowseItem[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.jlpt) {
    params.push(opts.jlpt);
    where.push(`jlpt = $${params.length}`);
  }
  if (opts.grade != null) {
    params.push(opts.grade);
    where.push(`grade = $${params.length}`);
  }
  if (opts.q) {
    params.push(opts.q);
    const i = params.length;
    where.push(`(character = $${i} OR array_to_string(meanings, ' ') ILIKE '%' || $${i} || '%')`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const res = await pool.query<BrowseRow>(
    `SELECT character, meanings, stroke_count, jlpt
       FROM kanji ${clause}
      ORDER BY grade NULLS LAST, stroke_count, character
      LIMIT 500`,
    params,
  );
  return res.rows.map((r) => ({
    character: r.character,
    meanings: r.meanings,
    stroke_count: r.stroke_count,
    jlpt: r.jlpt,
  }));
}

type DetailRow = {
  character: string;
  strokes: string[];
  stroke_count: number;
  radical: string | null;
  meanings: string[];
  on_yomi: string[];
  kun_yomi: string[];
  jlpt: string | null;
};

export async function getKanjiDetail(character: string): Promise<KanjiDetail | null> {
  const res = await pool.query<DetailRow>(
    `SELECT character, strokes, stroke_count, radical, meanings, on_yomi, kun_yomi, jlpt
       FROM kanji WHERE character = $1`,
    [character],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    character: r.character,
    strokes: r.strokes,
    stroke_count: r.stroke_count,
    radical: r.radical,
    meanings: r.meanings,
    on: r.on_yomi,
    kun: r.kun_yomi,
    jlpt: r.jlpt,
  };
}
