import { pool } from "../db/pool.js";

export const DEFAULT_TARGET = 30;

export type DailyBudget = {
  target: number;        // the configured setting
  extra_rounds: number;  // extra rounds unlocked today
  allowance: number;     // target × (1 + extra_rounds)
  reviewed: number;      // reviews logged today, in `tz`
  remaining: number;     // max(0, allowance − reviewed)
};

async function readTarget(): Promise<number> {
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

async function readReviewedToday(tz: string): Promise<number> {
  const r = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c
       FROM reviews
      WHERE date_trunc('day', reviewed_at AT TIME ZONE $1)
          = date_trunc('day', now() AT TIME ZONE $1)`,
    [tz],
  );
  return r.rows[0]?.c ?? 0;
}

// First-ever reviews (box_before = 0) logged today, across every skill. The
// new-card budget is deliberately global: one daily target means one budget,
// and scoping it per skill would let eight skills each introduce a full share.
export async function countIntroducedToday(tz: string): Promise<number> {
  const r = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c
       FROM reviews
      WHERE box_before = 0
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
