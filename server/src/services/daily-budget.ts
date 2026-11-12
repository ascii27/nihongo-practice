import { pool } from "../db/pool.js";

export const DEFAULT_TARGET = 30;

export type DailyBudget = {
  target: number;        // the configured setting
  extra_rounds: number;  // extra rounds unlocked today
  allowance: number;     // target × (1 + extra_rounds)
  reviewed: number;      // reviews logged today, in `tz`
  remaining: number;     // max(0, allowance − reviewed)
};

export async function readTarget(): Promise<number> {
  const r = await pool.query<{ t: number }>(
    `SELECT daily_review_target AS t FROM app_settings LIMIT 1`,
  );
  return r.rows[0]?.t ?? DEFAULT_TARGET;
}

async function readExtraRounds(tz: string): Promise<number> {
  const r = await pool.query<{ n: number }>(
    `SELECT extra_rounds AS n FROM daily_rounds WHERE day = (now() AT TIME ZONE $1)::date`,
    [tz],
  );
  return r.rows[0]?.n ?? 0;
}

// Free-practice rows are excluded: they are drills — practice the owner chose
// on top of the day's plan rather than a draw against it. Counting them would
// let one 40-card drill before class zero out `remaining` and leave every
// practice entry point empty until midnight.
async function readReviewedToday(tz: string): Promise<number> {
  const r = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c
       FROM reviews
      WHERE free_practice = false
        AND date_trunc('day', reviewed_at AT TIME ZONE $1)
          = date_trunc('day', now() AT TIME ZONE $1)`,
    [tz],
  );
  return r.rows[0]?.c ?? 0;
}

// First-ever reviews (box_before = 0) logged today, across every skill. The
// new-card budget is deliberately global: one daily target means one budget,
// and scoping it per skill would let eight skills each introduce a full share.
//
// Drill rows (free_practice) are excluded: a drill never creates review_state,
// so a drilled new card is still new and introduces nothing. (Before 2026-11,
// skill-row free practice did introduce cards; only today's rows matter here.)
export async function countIntroducedToday(tz: string): Promise<number> {
  const r = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c
       FROM reviews
      WHERE box_before = 0
        AND free_practice = false
        AND date_trunc('day', reviewed_at AT TIME ZONE $1)
          = date_trunc('day', now() AT TIME ZONE $1)`,
    [tz],
  );
  return r.rows[0]?.c ?? 0;
}

export async function getDailyBudget(tz: string): Promise<DailyBudget> {
  const [target, extra_rounds, reviewed] = await Promise.all([
    readTarget(),
    readExtraRounds(tz),
    readReviewedToday(tz),
  ]);
  const allowance = target * (1 + extra_rounds);
  return { target, extra_rounds, allowance, reviewed, remaining: Math.max(0, allowance - reviewed) };
}

// The budget as it would stand after one more round, without writing anything.
// The dashboard needs this to decide whether offering "Go another round" would
// actually deal any cards: a round raises both the allowance and the new-card
// share, but neither helps if the deck has nothing left to give.
export function previewRound(b: DailyBudget): DailyBudget {
  const extra_rounds = b.extra_rounds + 1;
  const allowance = b.target * (1 + extra_rounds);
  return { ...b, extra_rounds, allowance, remaining: Math.max(0, allowance - b.reviewed) };
}

// Unlocks one more full target for today. Repeatable — each call adds a round.
export async function unlockRound(tz: string): Promise<DailyBudget> {
  await pool.query(
    `INSERT INTO daily_rounds (day, extra_rounds)
     VALUES ((now() AT TIME ZONE $1)::date, 1)
     ON CONFLICT (day) DO UPDATE SET extra_rounds = daily_rounds.extra_rounds + 1`,
    [tz],
  );
  return getDailyBudget(tz);
}
