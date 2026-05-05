import { pool } from "../db/pool.js";
import type { ItemRecord } from "@nihongo/shared";

const NEW_THRESHOLD = 10;
const NEW_CAP = 10;

type Row = {
  id: string;
  skill: string;
  prompt: unknown;
  answer: unknown;
  source: string;
  tags: string[];
  created_at: Date;
};

function toRecord(r: Row): ItemRecord {
  return {
    id: r.id,
    skill: r.skill as ItemRecord["skill"],
    prompt: r.prompt as ItemRecord["prompt"],
    answer: r.answer as ItemRecord["answer"],
    source: r.source as ItemRecord["source"],
    tags: r.tags,
    created_at: r.created_at.toISOString(),
  };
}

export async function buildQueue(opts: { limit: number }): Promise<{ due: ItemRecord[]; new: ItemRecord[] }> {
  const dueRes = await pool.query<Row>(
    `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.tags, i.created_at
       FROM items i
       JOIN review_state rs ON rs.item_id = i.id
      WHERE i.skill = 'vocab'
        AND rs.next_review_at <= now()
      ORDER BY rs.next_review_at ASC
      LIMIT $1`,
    [opts.limit],
  );
  const due = dueRes.rows.map(toRecord);

  let neu: ItemRecord[] = [];
  if (due.length < NEW_THRESHOLD) {
    const newRes = await pool.query<Row>(
      `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.tags, i.created_at
         FROM items i
         LEFT JOIN review_state rs ON rs.item_id = i.id
        WHERE i.skill = 'vocab' AND rs.item_id IS NULL
        ORDER BY i.created_at ASC
        LIMIT $1`,
      [NEW_CAP],
    );
    neu = newRes.rows.map(toRecord);
  }

  return { due, new: neu };
}
