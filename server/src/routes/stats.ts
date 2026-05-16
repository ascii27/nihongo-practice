import { Router } from "express";
import { computeStreak } from "../services/streak.js";
import { pool } from "../db/pool.js";

export const statsRouter = Router();

const SKILLS = ["vocab", "grammar", "reading", "conjugation", "particle"] as const;

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
