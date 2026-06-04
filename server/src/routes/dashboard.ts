import { Router } from "express";
import { pool } from "../db/pool.js";
import { computeStreak } from "../services/streak.js";

const SKILLS = ["vocab", "grammar", "reading", "conjugation", "particle", "explain"] as const;

export const dashboardRouter = Router();

dashboardRouter.get("/", async (_req, res) => {
  // Due counts per skill: items with review_state.next_review_at <= now().
  const dueRes = await pool.query<{ skill: string; c: string }>(
    `SELECT i.skill, count(*)::text AS c
       FROM items i JOIN review_state rs ON rs.item_id = i.id
      WHERE rs.next_review_at <= now()
      GROUP BY i.skill`,
  );
  const due = new Map(dueRes.rows.map((r) => [r.skill, Number(r.c)]));

  // New counts per skill: items with no review_state. The actual session size
  // is still bounded by the queue's own NEW_CAP — this count is the visible
  // pool, so a bulk-imported deck (300+ vocab) is reflected honestly.
  const newRes = await pool.query<{ skill: string; c: string }>(
    `SELECT i.skill, count(*)::text AS c
       FROM items i LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE rs.item_id IS NULL
      GROUP BY i.skill`,
  );
  const fresh = new Map(newRes.rows.map((r) => [r.skill, Number(r.c)]));

  // Last practice timestamp.
  const lastRes = await pool.query<{ ts: Date | null }>(
    `SELECT max(reviewed_at) AS ts FROM reviews`,
  );
  const last = lastRes.rows[0]?.ts ?? null;

  // Streak: uses existing services/streak.ts (tz-aware computeStreak).
  // Dashboard uses UTC; the Stats screen still has the tz-aware endpoint.
  // Owner is single-user — UTC drift is fine.
  const streakDays = await computeStreak("UTC");

  const by_skill: Record<string, { due: number; new: number }> = {};
  for (const s of SKILLS) {
    by_skill[s] = { due: due.get(s) ?? 0, new: fresh.get(s) ?? 0 };
  }

  res.json({
    streak_days: streakDays,
    last_practiced_at: last ? last.toISOString() : null,
    by_skill,
  });
});
