import { Router } from "express";
import { pool } from "../db/pool.js";
import { computeStreak } from "../services/streak.js";
import { getDailyBudget, unlockRound, previewRound, countIntroducedToday } from "../services/daily-budget.js";
import { planSession, sessionSize, DEFAULT_QUEUE_LIMIT } from "../services/session-plan.js";
import { resolveTz } from "../services/tz.js";
import type { DailyBudget } from "../services/daily-budget.js";

const SKILLS = ["vocab", "grammar", "reading", "conjugation", "particle", "explain", "listening", "kanji"] as const;

export const dashboardRouter = Router();

async function buildPayload(tz: string, budget: DailyBudget) {
  // Due counts per skill: items with review_state.next_review_at <= now().
  // Suspended items are excluded to match services/queue.ts — a card the queue
  // will never deal must not be counted as work waiting for you.
  const dueRes = await pool.query<{ skill: string; c: string }>(
    `SELECT i.skill, count(*)::text AS c
       FROM items i JOIN review_state rs ON rs.item_id = i.id
      WHERE rs.next_review_at <= now()
        AND rs.suspended = false
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

  // What the next mixed-practice session would actually deal. `remaining` alone
  // over-promises: the new-card share caps how much of a new-only deck a session
  // can touch, so a 300-new deck at a target of 30 yields 10 cards, not 30. The
  // hero renders this number directly — it must not re-derive one of its own.
  //
  // Mixed practice sends no `skill` and no `limit`, so the pools are summed
  // across every skill and the plan uses the queue route's default limit.
  const totalNew = newRes.rows.reduce((acc, r) => acc + Number(r.c), 0);
  const totalDue = dueRes.rows.reduce((acc, r) => acc + Number(r.c), 0);
  const available = { new: totalNew, due: totalDue };

  const introducedToday = await countIntroducedToday(tz);
  const session_size = sessionSize(
    planSession(budget, introducedToday, DEFAULT_QUEUE_LIMIT),
    available,
  );
  // And what it would deal after unlocking one more round. A round raises the
  // allowance and the new-card share together, so it can rescue a session that
  // is empty for either reason — but not always. 0 means "offering another
  // round would be a dead end", which is how the client decides to show it.
  const another_round_size = sessionSize(
    planSession(previewRound(budget), introducedToday, DEFAULT_QUEUE_LIMIT),
    available,
  );

  return {
    streak_days: streakDays,
    last_practiced_at: last ? last.toISOString() : null,
    daily_target: budget.target,
    reviewed_today: budget.reviewed,
    remaining: budget.remaining,
    session_size,
    another_round_size,
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
