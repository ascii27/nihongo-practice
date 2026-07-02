import { pool } from "../db/pool.js";
import { runGeneration } from "./generate.js";
import type { Skill } from "@nihongo/shared";

// Per-section item counts for a generated lesson. Small, focused sets — a lesson
// teaches a topic, it is not a bulk drill. Listening/explain are token-heavy so
// they stay at 1.
export const SECTION_COUNTS: Record<Skill, number> = {
  vocab: 5,
  grammar: 3,
  particle: 3,
  conjugation: 3,
  reading: 1,
  listening: 1,
  explain: 1,
};

// The existing per-skill generators accept a free-text `weakness_hint`; we use it
// to steer generation toward the lesson's topic at the target JLPT level.
export function buildWeaknessHint(topic: string, jlpt_level: string): string {
  return `Topic: ${topic}. Target JLPT level: ${jlpt_level}. Keep vocabulary and grammar appropriate to ${jlpt_level}.`;
}

// Runs the full lesson generation. NEVER throws — records failure on the row.
export async function generateLessonInto(
  lessonId: string,
  topic: string,
  jlpt_level: string,
  skills: Skill[],
): Promise<void> {
  const hint = buildWeaknessHint(topic, jlpt_level);
  let totalCost = 0;
  try {
    for (const skill of skills) {
      const r = await runGeneration({ skill, count: SECTION_COUNTS[skill], weakness_hint: hint });
      totalCost += r.cost_usd;
      const tag = `lesson:${lessonId}`;
      for (const [i, item] of r.items.entries()) {
        await pool.query(
          `UPDATE items SET tags = array_append(tags, $2) WHERE id = $1 AND NOT ($2 = ANY(tags))`,
          [item.id, tag],
        );
        await pool.query(
          `INSERT INTO lesson_items (lesson_id, item_id, section, position)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (lesson_id, item_id) DO NOTHING`,
          [lessonId, item.id, skill, i],
        );
      }
    }
    await pool.query(
      `UPDATE lessons SET status = 'ready', cost_usd = $2, generated_at = now() WHERE id = $1`,
      [lessonId, totalCost],
    );
  } catch (err) {
    await pool.query(
      `UPDATE lessons SET status = 'failed', error = $2, cost_usd = $3 WHERE id = $1`,
      [lessonId, err instanceof Error ? err.message.slice(0, 1000) : String(err), totalCost],
    );
  }
}
