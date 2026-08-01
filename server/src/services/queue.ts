import { pool } from "../db/pool.js";
import type { ItemRecord } from "@nihongo/shared";
import { getDailyBudget, countIntroducedToday } from "./daily-budget.js";
import { planSession } from "./session-plan.js";

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

  // Session size comes from the daily budget via the shared planner, so the
  // number on the dashboard hero and the session it starts can never disagree.
  const budget = await getDailyBudget(opts.tz);
  const introducedToday = await countIntroducedToday(opts.tz);
  const { sessionCap, newLimit } = planSession(budget, introducedToday, opts.limit);
  if (sessionCap <= 0) return { due: [], new: [] };

  // New first, so that when new cards run short due fills the whole cap instead
  // of the session stopping there. `sessionSize` models this same ordering.
  let neu: ItemRecord[] = [];
  if (newLimit > 0) {
    const newRes = await pool.query<Row>(
      `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.tags, i.created_at
         FROM items i
         LEFT JOIN review_state rs ON rs.item_id = i.id
        WHERE ($1::text IS NULL OR i.skill = $1) AND rs.item_id IS NULL
        ORDER BY i.created_at ASC
        LIMIT $2`,
      [skillFilter, newLimit],
    );
    neu = newRes.rows.map(toRecord);
  }

  // Due: a random sample of currently-due, non-suspended items, filling
  // whatever the new cards left of the session cap.
  const dueLimit = sessionCap - neu.length;
  let due: ItemRecord[] = [];
  if (dueLimit > 0) {
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
    due = dueRes.rows.map(toRecord);
  }

  return { due, new: neu };
}
