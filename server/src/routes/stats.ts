import { Router } from "express";
import { computeStreak, longestStreak, ymdInTz, decYmd } from "../services/streak.js";
import { itemDisplay } from "../services/item-display.js";
import { pool } from "../db/pool.js";

export const statsRouter = Router();

const SKILLS = ["vocab", "grammar", "reading", "conjugation", "particle"] as const;

function validateTz(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    new Date().toLocaleString("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

statsRouter.get("/streak", async (req, res) => {
  const tz = req.query.tz;
  if (typeof tz !== "string" || tz.length === 0) {
    res.status(400).json({ error: "tz query param required (IANA timezone)", code: "TZ_REQUIRED" });
    return;
  }
  // Validate the tz by attempting a no-op conversion. Throws on bad zone.
  try {
    new Date().toLocaleString("en-US", { timeZone: tz });
  } catch {
    res.status(400).json({ error: "invalid tz", code: "TZ_INVALID" });
    return;
  }
  const days = await computeStreak(tz);
  res.json({ days });
});

statsRouter.get("/by-skill", async (_req, res) => {
  const boxRes = await pool.query<{ skill: string; box: number; c: string }>(
    `SELECT i.skill, rs.box, count(*)::text AS c
       FROM items i JOIN review_state rs ON rs.item_id = i.id
      GROUP BY i.skill, rs.box`,
  );
  const accRes = await pool.query<{ skill: string; total: string; missed: string }>(
    `SELECT i.skill,
            count(*)::text AS total,
            count(*) FILTER (WHERE r.result='missed')::text AS missed
       FROM reviews r JOIN items i ON i.id = r.item_id
      WHERE r.reviewed_at >= now() - interval '30 days'
      GROUP BY i.skill`,
  );
  const by_skill: Record<string, { box_counts: number[]; accuracy_30d: number | null }> = {};
  for (const s of SKILLS) {
    by_skill[s] = { box_counts: [0, 0, 0, 0, 0], accuracy_30d: null };
  }
  for (const row of boxRes.rows) {
    const target = by_skill[row.skill];
    if (target && row.box >= 1 && row.box <= 5) {
      target.box_counts[row.box - 1] = Number(row.c);
    }
  }
  for (const row of accRes.rows) {
    const total = Number(row.total);
    const missed = Number(row.missed);
    const target = by_skill[row.skill];
    if (target && total > 0) {
      target.accuracy_30d = (total - missed) / total;
    }
  }
  res.json({ by_skill });
});

// GET /api/stats/overview?tz=… — aggregates for the Stats screen: streaks,
// lifetime totals + accuracy, last-30-day review counts, and the lowest-
// accuracy cards (≥3 reviews of signal). tz defaults to UTC.
statsRouter.get("/overview", async (req, res) => {
  const tz = typeof req.query.tz === "string" && req.query.tz.length > 0 ? req.query.tz : "UTC";
  if (!validateTz(tz)) {
    res.status(400).json({ error: "invalid tz", code: "TZ_INVALID" });
    return;
  }

  const [streak_days, longest_streak] = await Promise.all([computeStreak(tz), longestStreak(tz)]);

  const totalsRes = await pool.query<{ total: string; got: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE result = 'got_it')::text AS got
       FROM reviews`,
  );
  const total_reviewed = Number(totalsRes.rows[0]?.total ?? 0);
  const got = Number(totalsRes.rows[0]?.got ?? 0);
  const overall_accuracy = total_reviewed > 0 ? got / total_reviewed : null;

  // Per-day counts (tz-bucketed), assembled into a fixed 30-slot array that
  // ends today so the chart x-axis is stable even on days with no reviews.
  const dailyRes = await pool.query<{ d: string; c: string }>(
    `SELECT to_char(date_trunc('day', reviewed_at AT TIME ZONE $1), 'YYYY-MM-DD') AS d,
            count(*)::text AS c
       FROM reviews
      GROUP BY d`,
    [tz],
  );
  const counts = new Map(dailyRes.rows.map((r) => [r.d, Number(r.c)]));
  const days: string[] = [];
  let cursor = ymdInTz(new Date(), tz);
  for (let i = 0; i < 30; i++) {
    days.push(cursor);
    cursor = decYmd(cursor);
  }
  const daily_reviews = days.reverse().map((d) => counts.get(d) ?? 0);

  const hardRes = await pool.query<{
    id: string;
    skill: string;
    prompt: unknown;
    answer: unknown;
    total_reviews: number;
    total_missed: number;
  }>(
    `SELECT i.id, i.skill, i.prompt, i.answer, rs.total_reviews, rs.total_missed
       FROM review_state rs JOIN items i ON i.id = rs.item_id
      WHERE rs.total_reviews >= 3
      ORDER BY (rs.total_reviews - rs.total_missed)::float / rs.total_reviews ASC,
               rs.total_reviews DESC
      LIMIT 5`,
  );
  const hardest_cards = hardRes.rows.map((row) => {
    const d = itemDisplay(row.skill as (typeof SKILLS)[number], row.prompt, row.answer);
    return {
      id: row.id,
      skill: row.skill,
      front: d.front,
      meaning: d.meaning,
      accuracy: (row.total_reviews - row.total_missed) / row.total_reviews,
    };
  });

  res.json({ streak_days, longest_streak, total_reviewed, overall_accuracy, daily_reviews, hardest_cards });
});
