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
import { pool } from "../db/pool.js";

export const itemsRouter = Router();

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
