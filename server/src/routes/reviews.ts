import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { nextState, type ReviewStateRow } from "../services/leitner.js";
import { itemDisplay } from "../services/item-display.js";
import { detectStreakMilestone, ymdInTz } from "../services/streak.js";
import { emitReviewLogged, emitMilestone } from "../services/hermes.js";
import type { Skill } from "@nihongo/shared";

export const reviewsRouter = Router();

// `reviewed_at` is the (item_id, reviewed_at) idempotency key. The client uses
// `new Date().toISOString()` which is millisecond-precision; two reviews of
// the same item within 1ms are treated as the same submission.
const Body = z.object({
  item_id: z.string().uuid(),
  result: z.enum(["got_it", "missed"]),
  reviewed_at: z.string().datetime(),
  session_id: z.string().uuid().optional(),
  answer_given: z.string().max(200).optional(),
  tz: z.string().optional(), // IANA timezone, for streak-milestone events
});

reviewsRouter.post("/", async (req, res) => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", code: "BAD_BODY" });
    return;
  }
  const { item_id, result, reviewed_at, session_id, answer_given, tz } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verify item exists (and load fields used to name the card in Hermes events)
    const itemRes = await client.query<{ id: string; skill: string; prompt: unknown; answer: unknown }>(
      `SELECT id, skill, prompt, answer FROM items WHERE id = $1`, [item_id],
    );
    if (itemRes.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "item not found", code: "ITEM_NOT_FOUND" });
      return;
    }

    // Check idempotency: existing review at same timestamp?
    const dup = await client.query(
      `SELECT 1 FROM reviews WHERE item_id = $1 AND reviewed_at = $2`,
      [item_id, reviewed_at],
    );
    if ((dup.rowCount ?? 0) > 0) {
      const existing = await client.query(
        `SELECT box, next_review_at, total_reviews, total_missed FROM review_state WHERE item_id = $1`,
        [item_id],
      );
      await client.query("COMMIT");
      const row = existing.rows[0];
      res.json({
        box: row.box,
        next_review_at: row.next_review_at.toISOString(),
        total_reviews: row.total_reviews,
        total_missed: row.total_missed,
      });
      return;
    }

    // Load existing state, if any
    const stateRes = await client.query(
      `SELECT box, next_review_at, last_reviewed_at, total_reviews, total_missed, suspended
         FROM review_state WHERE item_id = $1`,
      [item_id],
    );
    const prev: ReviewStateRow | null = stateRes.rowCount === 0 ? null : {
      box: stateRes.rows[0].box,
      next_review_at: stateRes.rows[0].next_review_at,
      last_reviewed_at: stateRes.rows[0].last_reviewed_at,
      total_reviews: stateRes.rows[0].total_reviews,
      total_missed: stateRes.rows[0].total_missed,
      suspended: stateRes.rows[0].suspended,
    };

    const next = nextState(prev, result, new Date());

    const suspended = (prev?.suspended ?? false) || next.total_missed >= 8;

    // Upsert review_state
    await client.query(
      `INSERT INTO review_state (item_id, box, next_review_at, last_reviewed_at, total_reviews, total_missed, suspended)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (item_id) DO UPDATE
         SET box = EXCLUDED.box,
             next_review_at = EXCLUDED.next_review_at,
             last_reviewed_at = EXCLUDED.last_reviewed_at,
             total_reviews = EXCLUDED.total_reviews,
             total_missed = EXCLUDED.total_missed,
             suspended = EXCLUDED.suspended`,
      [item_id, next.box, next.next_review_at, next.last_reviewed_at, next.total_reviews, next.total_missed, suspended],
    );

    // Append-only review row
    await client.query(
      `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after, session_id, answer_given)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [item_id, reviewed_at, result, prev?.box ?? 0, next.box, session_id ?? null, answer_given ?? null],
    );

    await client.query("COMMIT");
    res.json({
      box: next.box,
      next_review_at: next.next_review_at.toISOString(),
      total_reviews: next.total_reviews,
      total_missed: next.total_missed,
    });

    // Fire-and-forget progress events to Hermes (opt-in; no-op when
    // unconfigured). Guarded so it can never disturb the already-sent response.
    try {
      const item = itemRes.rows[0]!;
      const display = itemDisplay(item.skill as Skill, item.prompt, item.answer);
      void emitReviewLogged({
        item_id, skill: item.skill, result, reviewed_at,
        box_before: prev?.box ?? 0, box_after: next.box,
        total_reviews: next.total_reviews, total_missed: next.total_missed,
        suspended, session_id: session_id ?? null,
        front: display.front, meaning: display.meaning,
      }).catch(() => {});
      if (tz) {
        void detectStreakMilestone(tz).then((threshold) => {
          if (threshold) {
            return emitMilestone(
              { milestone_type: "streak", streak_days: threshold, session_date: ymdInTz(new Date(), tz), item_id },
              new Date().toISOString(),
            );
          }
        }).catch(() => {});
      }
    } catch (emitErr) {
      console.error("hermes: emit setup failed", emitErr);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});
