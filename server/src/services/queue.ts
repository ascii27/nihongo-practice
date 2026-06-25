import { pool } from "../db/pool.js";
import type { ItemRecord } from "@nihongo/shared";

const DAILY_NEW_CAP = 10;
const DUE_CAP = 20;

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

export async function buildQueue(
  opts: { limit: number; skill?: string; tz: string },
): Promise<{ due: ItemRecord[]; new: ItemRecord[] }> {
  const skillFilter = opts.skill ?? null;

  // Due: a random sample of currently-due, non-suspended items, capped per session.
  const dueLimit = Math.min(opts.limit, DUE_CAP);
  const dueRes = await pool.query<Row>(
    `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.tags, i.created_at
       FROM items i
       JOIN review_state rs ON rs.item_id = i.id
      WHERE ($1::text IS NULL OR i.skill = $1)
        AND rs.next_review_at <= now()
        AND rs.suspended = false
      ORDER BY random()
      LIMIT $2`,
    [skillFilter, dueLimit],
  );
  const due = dueRes.rows.map(toRecord);

  // New: serve up to (DAILY_NEW_CAP - introduced today) brand-new items,
  // independent of the due backlog. "Introduced today" = first-ever reviews
  // (box_before = 0) bucketed by calendar day in the caller's timezone, scoped
  // to the same skill filter the queue is serving.
  const introRes = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c
       FROM reviews r
       JOIN items i ON i.id = r.item_id
      WHERE r.box_before = 0
        AND ($2::text IS NULL OR i.skill = $2)
        AND date_trunc('day', r.reviewed_at AT TIME ZONE $1)
          = date_trunc('day', now() AT TIME ZONE $1)`,
    [opts.tz, skillFilter],
  );
  const introducedToday = introRes.rows[0]?.c ?? 0;
  const newBudget = Math.max(0, DAILY_NEW_CAP - introducedToday);

  let neu: ItemRecord[] = [];
  if (newBudget > 0) {
    const newRes = await pool.query<Row>(
      `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.tags, i.created_at
         FROM items i
         LEFT JOIN review_state rs ON rs.item_id = i.id
        WHERE ($1::text IS NULL OR i.skill = $1) AND rs.item_id IS NULL
        ORDER BY i.created_at ASC
        LIMIT $2`,
      [skillFilter, newBudget],
    );
    neu = newRes.rows.map(toRecord);
  }

  return { due, new: neu };
}
