import { pool } from "../db/pool.js";
import type { Focus, ItemRecord } from "@nihongo/shared";
import { getDailyBudget, countIntroducedToday } from "./daily-budget.js";
import { planSession, drillLimit } from "./session-plan.js";
import { focusClause } from "./focus.js";

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

const SELECT_ITEM = `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.tags, i.created_at FROM items i`;

// Brand-new items. Tagged first — a tag is the learner saying "this matters
// now" (class material) — then oldest first, so a deck is worked in order and
// a big imported backlog can't bury what was just added for class.
async function fetchNew(focus: Focus, limit: number): Promise<ItemRecord[]> {
  if (limit <= 0) return [];
  const f = focusClause(focus, 2);
  const res = await pool.query<Row>(
    `${SELECT_ITEM}
       LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE rs.item_id IS NULL ${f.sql}
      ORDER BY EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id) DESC, i.created_at ASC
      LIMIT $1`,
    [limit, ...f.params],
  );
  return res.rows.map(toRecord);
}

// A random sample of currently-due, non-suspended items.
async function fetchDue(focus: Focus, limit: number): Promise<ItemRecord[]> {
  if (limit <= 0) return [];
  const f = focusClause(focus, 2);
  const res = await pool.query<Row>(
    `${SELECT_ITEM}
       JOIN review_state rs ON rs.item_id = i.id
      WHERE rs.next_review_at <= now() AND rs.suspended = false ${f.sql}
      ORDER BY random()
      LIMIT $1`,
    [limit, ...f.params],
  );
  return res.rows.map(toRecord);
}

export async function buildQueue(
  opts: { limit: number; focus: Focus; tz: string },
): Promise<{ due: ItemRecord[]; new: ItemRecord[] }> {
  // Session size comes from the global daily budget via the shared planner, so
  // the number on the dashboard hero and the session it starts can never
  // disagree. A focus narrows which cards are dealt, never how many the day
  // allows.
  const budget = await getDailyBudget(opts.tz);
  const introducedToday = await countIntroducedToday(opts.tz);
  const { sessionCap, newLimit } = planSession(budget, introducedToday, opts.limit);
  if (sessionCap <= 0) return { due: [], new: [] };

  // New first, so that when new cards run short due fills the whole cap instead
  // of the session stopping there. `sessionSize` models this same ordering.
  const neu = await fetchNew(opts.focus, newLimit);
  const due = await fetchDue(opts.focus, sessionCap - neu.length);

  return { due, new: neu };
}

// Drill ("drill all anyway"): every non-suspended card in the focus, shuffled,
// schedule and daily budget ignored. Grading uses mode "drill", which leaves
// review_state alone. A skill-only focus is sampled (see `drillLimit`).
export async function buildDrill(focus: Focus): Promise<ItemRecord[]> {
  const f = focusClause(focus, 1);
  const cap = drillLimit(focus);
  const res = await pool.query<Row>(
    `${SELECT_ITEM}
       LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE COALESCE(rs.suspended, false) = false ${f.sql}
      ORDER BY random()
      ${cap === null ? "" : `LIMIT ${cap}`}`,
    f.params,
  );
  return res.rows.map(toRecord);
}

// How many cards `buildDrill` would deal — the "Drill all N anyway" number.
export async function countDrill(focus: Focus): Promise<number> {
  const f = focusClause(focus, 1);
  const r = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c
       FROM items i LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE COALESCE(rs.suspended, false) = false ${f.sql}`,
    f.params,
  );
  const n = r.rows[0]?.c ?? 0;
  const cap = drillLimit(focus);
  return cap === null ? n : Math.min(n, cap);
}
