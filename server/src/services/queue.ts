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

// Brand-new items: never reviewed, oldest first so a deck is worked in order.
async function fetchNew(skillFilter: string | null, limit: number): Promise<ItemRecord[]> {
  if (limit <= 0) return [];
  const res = await pool.query<Row>(
    `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.tags, i.created_at
       FROM items i
       LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE ($1::text IS NULL OR i.skill = $1) AND rs.item_id IS NULL
      ORDER BY i.created_at ASC
      LIMIT $2`,
    [skillFilter, limit],
  );
  return res.rows.map(toRecord);
}

// A random sample of currently-due, non-suspended items.
async function fetchDue(skillFilter: string | null, limit: number): Promise<ItemRecord[]> {
  if (limit <= 0) return [];
  const res = await pool.query<Row>(
    `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.tags, i.created_at
       FROM items i
       JOIN review_state rs ON rs.item_id = i.id
      WHERE ($1::text IS NULL OR i.skill = $1)
        AND rs.next_review_at <= now()
        AND rs.suspended = false
      ORDER BY random()
      LIMIT $2`,
    [skillFilter, limit],
  );
  return res.rows.map(toRecord);
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
  const neu = await fetchNew(skillFilter, newLimit);
  const due = await fetchDue(skillFilter, sessionCap - neu.length);

  return { due, new: neu };
}

// Free practice: a fixed-size session that ignores the daily budget entirely.
//
// This is what a skill row on Today deals. It exists so the owner can always
// drill a skill on purpose — the daily target governs the day's plan, not
// whether practice is allowed at all. Neither the allowance nor the new-card
// pacing limit gates it, and the reviews it produces are flagged
// `free_practice` so they don't count against the target either.
//
// Due first, unlike `buildQueue`: someone who asked for this skill wants the
// cards they actually owe on it, with new cards topping up only what's left.
// The budgeted queue leads with new because its new-card share is metered and
// would otherwise go unspent on a deep due backlog; free practice has no share
// to protect.
export async function buildFreeQueue(
  opts: { limit: number; skill?: string },
): Promise<{ due: ItemRecord[]; new: ItemRecord[] }> {
  const skillFilter = opts.skill ?? null;
  const cap = Math.max(0, opts.limit);
  if (cap === 0) return { due: [], new: [] };

  const due = await fetchDue(skillFilter, cap);
  const neu = await fetchNew(skillFilter, cap - due.length);

  return { due, new: neu };
}
