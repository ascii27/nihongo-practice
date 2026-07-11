import { pool } from "../db/pool.js";
import type { GrammarPoint, JlptLevel } from "@nihongo/shared";

type Row = {
  id: string;
  jlpt_level: string;
  sort_order: number;
  title: string;
  romaji: string | null;
  meaning: string;
  slug: string;
};

function toGrammarPoint(r: Row): GrammarPoint {
  return {
    id: r.id,
    jlpt_level: r.jlpt_level as JlptLevel,
    sort_order: r.sort_order,
    title: r.title,
    romaji: r.romaji,
    meaning: r.meaning,
    slug: r.slug,
  };
}

const SELECT = `SELECT id, jlpt_level, sort_order, title, romaji, meaning, slug FROM grammar_points`;

// All grammar points for a JLPT level, in catalog order (for the manual picker
// and as the pool the auto-mode selector chooses from).
export async function listGrammarPoints(level: JlptLevel): Promise<GrammarPoint[]> {
  const r = await pool.query<Row>(`${SELECT} WHERE jlpt_level = $1 ORDER BY sort_order ASC`, [level]);
  return r.rows.map(toGrammarPoint);
}

// Resolve a set of grammar point ids (manual mode). Returns them in catalog
// order; silently drops ids that don't exist.
export async function getGrammarPointsByIds(ids: string[]): Promise<GrammarPoint[]> {
  if (ids.length === 0) return [];
  const r = await pool.query<Row>(
    `${SELECT} WHERE id = ANY($1::uuid[]) ORDER BY jlpt_level, sort_order ASC`,
    [ids],
  );
  return r.rows.map(toGrammarPoint);
}
