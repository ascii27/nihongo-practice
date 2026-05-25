import { Router } from "express";
import { pool } from "../db/pool.js";
import { itemDisplay, boxToMastery } from "../services/item-display.js";

export const libraryRouter = Router();

const SKILLS = ["vocab", "grammar", "reading", "conjugation", "particle"] as const;
type SkillName = (typeof SKILLS)[number];

// Cap items returned per skill — Browse renders a sample beneath a per-skill
// header that still reflects the true count + average mastery over all items.
const PER_SKILL_CAP = 50;

type Row = {
  id: string;
  skill: SkillName;
  prompt: unknown;
  answer: unknown;
  box: number | null;
};

// GET /api/library — every item grouped by skill, with a Leitner-box-derived
// mastery, for the Browse screen. Read-only; no pagination (single-user app).
libraryRouter.get("/", async (_req, res) => {
  const r = await pool.query<Row>(
    `SELECT i.id, i.skill, i.prompt, i.answer, rs.box
       FROM items i
       LEFT JOIN review_state rs ON rs.item_id = i.id
      ORDER BY i.created_at DESC`,
  );

  const by_skill: Record<string, { count: number; avg_mastery: number; items: unknown[] }> = {};
  for (const s of SKILLS) by_skill[s] = { count: 0, avg_mastery: 0, items: [] };

  const masterySum: Record<string, number> = {};
  for (const s of SKILLS) masterySum[s] = 0;

  for (const row of r.rows) {
    const group = by_skill[row.skill];
    if (!group) continue; // unknown skill — skip defensively
    const mastery = boxToMastery(row.box);
    group.count += 1;
    masterySum[row.skill]! += mastery;
    if (group.items.length < PER_SKILL_CAP) {
      const d = itemDisplay(row.skill, row.prompt, row.answer);
      group.items.push({ id: row.id, skill: row.skill, ...d, mastery });
    }
  }

  for (const s of SKILLS) {
    const g = by_skill[s]!;
    g.avg_mastery = g.count > 0 ? masterySum[s]! / g.count : 0;
  }

  res.json({ by_skill });
});
