import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  generateManualVocab,
  toRubyHtml,
  readingFor,
  computeCost,
  GenerateError,
} from "@nihongo/gen";
import { ManualVocabPreviewRequest, ManualVocabSaveRequest } from "@nihongo/shared";
import type { Skill } from "@nihongo/shared";
import { pool } from "../db/pool.js";
import { itemDisplay, boxToMastery } from "../services/item-display.js";

export const itemsRouter = Router();

// `/api/items/:id` sits under the same router as the `/manual` POST routes, so
// a non-uuid id is answered as a plain 404 rather than reaching Postgres and
// blowing up on an invalid uuid cast.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ItemRow = {
  id: string;
  skill: string;
  prompt: unknown;
  answer: unknown;
  source: string;
  tags: string[];
  created_at: Date;
  box: number | null;
  next_review_at: Date | null;
  last_reviewed_at: Date | null;
  total_reviews: number | null;
  total_missed: number | null;
};

// POST /api/items/manual/translate — preview only, no DB write.
// Calls the AI to fill in the missing side + a short example sentence so the
// learner can sanity-check before saving.
itemsRouter.post("/manual/translate", async (req, res) => {
  const parsed = ManualVocabPreviewRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "invalid input", code: "INVALID_INPUT" });
    return;
  }
  try {
    const { item, usage } = await generateManualVocab({ input: parsed.data.input });
    res.json({
      japanese: item.japanese,
      english: item.english,
      sentence_japanese: item.sentence_japanese,
      sentence_english: item.sentence_english,
      cost_usd: computeCost(usage),
    });
  } catch (err) {
    const message = err instanceof GenerateError
      ? err.message
      : err instanceof Error ? err.message : "translate failed";
    res.status(502).json({ error: message, code: "TRANSLATE_FAILED" });
  }
});

// POST /api/items/manual — commit the (possibly edited) preview to the deck.
// Stored with source='user', external_id='user-<uuid>', no review_state — so
// the new card lands in the "new" pool like any other unstudied item.
itemsRouter.post("/manual", async (req, res) => {
  const parsed = ManualVocabSaveRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "invalid input", code: "INVALID_INPUT" });
    return;
  }
  const { japanese, english, sentence_japanese, sentence_english } = parsed.data;

  // Enrich for the on-card display: furigana + kana reading.
  const sentence_ruby = await toRubyHtml(sentence_japanese);
  const reading = await readingFor(japanese);

  const prompt = { sentence_ruby, target: japanese, sentence_english };
  const answer = { meaning: english, reading };
  const externalId = `user-${randomUUID()}`;

  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ('vocab', $1, $2, 'user', $3)
     RETURNING id, skill, prompt, answer, source, external_id, tags, created_at`,
    [JSON.stringify(prompt), JSON.stringify(answer), externalId],
  );
  const row = r.rows[0];
  res.status(201).json({
    item: {
      id: row.id,
      skill: row.skill,
      prompt: row.prompt,
      answer: row.answer,
      source: row.source,
      external_id: row.external_id,
      tags: row.tags,
      created_at: row.created_at.toISOString(),
    },
  });
});

// GET /api/items/:id — one card in full: raw prompt/answer JSON (so the client
// can render the whole card per skill), the same derived display fields Browse
// shows, and its spaced-repetition state. Read-only.
itemsRouter.get("/:id", async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    res.status(404).json({ error: "item not found", code: "ITEM_NOT_FOUND" });
    return;
  }
  const r = await pool.query<ItemRow>(
    `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.tags, i.created_at,
            rs.box, rs.next_review_at, rs.last_reviewed_at,
            rs.total_reviews, rs.total_missed
       FROM items i
       LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE i.id = $1`,
    [req.params.id],
  );
  const row = r.rows[0];
  if (!row) {
    res.status(404).json({ error: "item not found", code: "ITEM_NOT_FOUND" });
    return;
  }
  const d = itemDisplay(row.skill as Skill, row.prompt, row.answer);
  res.json({
    id: row.id,
    skill: row.skill,
    prompt: row.prompt,
    answer: row.answer,
    source: row.source,
    tags: row.tags,
    created_at: row.created_at.toISOString(),
    front: d.front,
    reading: d.reading,
    meaning: d.meaning,
    mastery: boxToMastery(row.box),
    box: row.box,
    next_review_at: row.next_review_at ? row.next_review_at.toISOString() : null,
    last_reviewed_at: row.last_reviewed_at ? row.last_reviewed_at.toISOString() : null,
    total_reviews: row.total_reviews ?? 0,
    total_missed: row.total_missed ?? 0,
  });
});
