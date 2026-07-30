import { Router } from "express";
import { pool } from "../db/pool.js";
import { computeStreak } from "../services/streak.js";
import { getDailyBudget, unlockRound } from "../services/daily-budget.js";
import { resolveTz } from "../services/tz.js";
import type { DailyBudget } from "../services/daily-budget.js";

const SKILLS = ["vocab", "grammar", "reading", "conjugation", "particle", "explain", "listening", "kanji"] as const;

export const dashboardRouter = Router();

async function buildPayload(tz: string, budget: DailyBudget) {
  // Due counts per skill: items with review_state.next_review_at <= now().
  const dueRes = await pool.query<{ skill: string; c: string }>(
    `SELECT i.skill, count(*)::text AS c
       FROM items i JOIN review_state rs ON rs.item_id = i.id
      WHERE rs.next_review_at <= now()
      GROUP BY i.skill`,
  );
  const due = new Map(dueRes.rows.map((r) => [r.skill, Number(r.c)]));

  // New counts per skill: items with no review_state. These stay uncapped on
  // purpose — the hero is bounded by the daily target, but the per-skill rows
  // are the honest inventory of what is left.
  const newRes = await pool.query<{ skill: string; c: string }>(
    `SELECT i.skill, count(*)::text AS c
       FROM items i LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE rs.item_id IS NULL
      GROUP BY i.skill`,
  );
  const fresh = new Map(newRes.rows.map((r) => [r.skill, Number(r.c)]));

  const lastRes = await pool.query<{ ts: Date | null }>(
    `SELECT max(reviewed_at) AS ts FROM reviews`,
  );
  const last = lastRes.rows[0]?.ts ?? null;

  const streakDays = await computeStreak(tz);

  const by_skill: Record<string, { due: number; new: number }> = {};
  for (const s of SKILLS) {
    by_skill[s] = { due: due.get(s) ?? 0, new: fresh.get(s) ?? 0 };
  }

  return {
    streak_days: streakDays,
    last_practiced_at: last ? last.toISOString() : null,
    daily_target: budget.target,
    reviewed_today: budget.reviewed,
    remaining: budget.remaining,
    by_skill,
  };
}

dashboardRouter.get("/", async (req, res) => {
  const tz = resolveTz(req.query.tz);
  res.json(await buildPayload(tz, await getDailyBudget(tz)));
});

// Unlocks one more full target for today. Returns the complete dashboard
// payload so the client can swap state without a second round trip.
dashboardRouter.post("/round", async (req, res) => {
  const tz = resolveTz(req.query.tz);
  res.json(await buildPayload(tz, await unlockRound(tz)));
});
