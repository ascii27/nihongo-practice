import { pool } from "../db/pool.js";

// Returns the count of consecutive day-buckets ending "today" in the caller's
// timezone where at least one review was logged.
export async function computeStreak(tz: string): Promise<number> {
  const r = await pool.query<{ d: string }>(
    `SELECT DISTINCT to_char(date_trunc('day', reviewed_at AT TIME ZONE $1), 'YYYY-MM-DD') AS d
       FROM reviews
       ORDER BY d DESC`,
    [tz],
  );
  if (r.rowCount === 0) return 0;

  const todayStr = ymdInTz(new Date(), tz);
  let count = 0;
  let cursor = todayStr;
  for (const { d } of r.rows) {
    if (d === cursor) {
      count += 1;
      cursor = decYmd(cursor);
    } else if (count === 0 && d < todayStr) {
      return 0;
    } else {
      break;
    }
  }
  return count;
}

const STREAK_THRESHOLDS = [7, 14, 30] as const;
export type StreakThreshold = (typeof STREAK_THRESHOLDS)[number];

export function isStreakThreshold(n: number): n is StreakThreshold {
  return (STREAK_THRESHOLDS as readonly number[]).includes(n);
}

// After a fresh review commits: if it is the FIRST review of "today" in the
// caller's timezone AND the current streak has just reached a milestone
// threshold (7/14/30), return that threshold; otherwise null. The
// first-of-today gate prevents re-emitting the milestone on later same-day
// reviews (natural key = streak_days + session_date).
export async function detectStreakMilestone(tz: string): Promise<StreakThreshold | null> {
  const todayStr = ymdInTz(new Date(), tz);
  const r = await pool.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM reviews
      WHERE to_char(date_trunc('day', reviewed_at AT TIME ZONE $1), 'YYYY-MM-DD') = $2`,
    [tz, todayStr],
  );
  if (Number(r.rows[0]?.c ?? 0) !== 1) return null; // not the first review of today
  const streak = await computeStreak(tz);
  return isStreakThreshold(streak) ? streak : null;
}

// Returns the longest run of consecutive review days anywhere in history
// (not just the run ending today), in the caller's timezone.
export async function longestStreak(tz: string): Promise<number> {
  const r = await pool.query<{ d: string }>(
    `SELECT DISTINCT to_char(date_trunc('day', reviewed_at AT TIME ZONE $1), 'YYYY-MM-DD') AS d
       FROM reviews
       ORDER BY d ASC`,
    [tz],
  );
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const { d } of r.rows) {
    run = prev !== null && decYmd(d) === prev ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }
  return longest;
}

// Format a Date as YYYY-MM-DD as observed in the given IANA timezone.
export function ymdInTz(d: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

export function decYmd(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
