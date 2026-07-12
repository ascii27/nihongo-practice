import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import { runGeneration, enrichFor } from "./generate.js";
import { listGrammarPoints, getGrammarPointsByIds } from "./grammar-points.js";
import {
  generateGrammarLesson,
  generateGrammarSelection,
  generateLessonQuiz,
  generateReadingBatch,
  generateListeningBatch,
  toRubyHtml,
  computeCost,
} from "@nihongo/gen";
import type { ItemRecord, GrammarPoint, JlptLevel } from "@nihongo/shared";

// Per-lesson counts. A lesson teaches 1–3 grammar points, introduces 5 new
// vocab; reading/listening are single lesson-only tasks; the final quiz is a
// short mixed-format assessment.
const VOCAB_COUNT = 5;
const QUIZ_COUNT = 5;

type LessonRow = {
  mode: string;
  topic: string;
  jlpt_level: string;
  grammar_point_ids: string[];
};

// Runs the full grammar-centered lesson generation. NEVER throws — records
// failure on the lesson row. Order matters: resolve grammar points → teach the
// grammar → introduce vocab (before the practice that reuses it) → build the
// practice block (reading/listening lesson-only; quiz/cloze feed the SRS).
export async function generateLessonInto(lessonId: string): Promise<void> {
  let totalCost = 0;
  const addCost = (c: number) => { totalCost += c; };
  try {
    const lr = await pool.query<LessonRow>(
      `SELECT mode, topic, jlpt_level, grammar_point_ids FROM lessons WHERE id = $1`,
      [lessonId],
    );
    const lesson = lr.rows[0];
    if (!lesson) throw new Error("lesson not found");
    const jlpt = lesson.jlpt_level;

    // 1. Resolve the grammar points this lesson is built around.
    const points = await resolvePoints(lessonId, lesson, addCost);
    if (points.length === 0) throw new Error("no grammar points resolved");

    // 2. Teach each grammar point (step-by-step explanation + examples).
    for (const p of points) {
      const gl = await generateGrammarLesson({ point: { title: p.title, meaning: p.meaning }, jlpt_level: jlpt });
      addCost(computeCost(gl.usage));
      const dialog = await Promise.all(gl.dialog.map(async (line) => ({
        speaker: line.speaker,
        jp_ruby: await toRubyHtml(line.jp),
        en: line.en,
      })));
      const content = {
        point: { id: p.id, title: p.title, romaji: p.romaji, meaning: p.meaning },
        dialog,
        explanation: gl.explanation,
      };
      await storeSection(lessonId, `grammar:${p.id}`, content);
    }

    const grammarTitles = points.map((p) => p.title).join(", ");
    const hint = `Grammar focus: ${grammarTitles}. Theme: ${lesson.topic}. Target JLPT level: ${jlpt}. Use this grammar and keep vocabulary appropriate to ${jlpt}.`;

    // 3. Introduce 5 new vocab (real items → SRS). Reuse the vocab generator.
    const vocab = await runGeneration({ skill: "vocab", count: VOCAB_COUNT, weakness_hint: hint });
    addCost(vocab.cost_usd);
    await linkItems(lessonId, vocab.items, "vocab");
    const vocabWords = vocab.items
      .map((it) => String((it.prompt as Record<string, unknown>).target ?? ""))
      .filter((w) => w !== "");

    // 4. Reading (lesson-only content, never an SRS item).
    const rd = await generateReadingBatch({ count: 1, weakness_hint: hint });
    addCost(computeCost(rd.usage));
    if (rd.items[0]) {
      const enr = await enrichFor("reading", rd.items[0]);
      await storeSyntheticBlock(lessonId, "reading", "reading", enr);
    }

    // 5. Listening (lesson-only content, never an SRS item).
    const ls = await generateListeningBatch({ count: 1, weakness_hint: hint, jlpt_level: jlpt });
    addCost(computeCost(ls.usage));
    if (ls.items[0]) {
      const enr = await enrichFor("listening", ls.items[0]);
      addCost(enr.audio_cost_usd ?? 0);
      await storeSyntheticBlock(lessonId, "listening", "listening", enr);
    }

    // 6. Final quiz — a mixed-format assessment testing the grammar + vocab.
    //    Lesson-only content (scored once, not added to the SRS review queue).
    const quiz = await generateLessonQuiz({
      point: { title: points[0]!.title, meaning: points[0]!.meaning },
      vocab: vocabWords, jlpt_level: jlpt, count: QUIZ_COUNT,
    });
    addCost(computeCost(quiz.usage));
    const questions = await Promise.all(quiz.questions.map(async (q) => ({
      question: q.question,
      ...(q.sentence_japanese && q.sentence_japanese.trim() ? { sentence_ruby: await toRubyHtml(q.sentence_japanese) } : {}),
      options: q.options,
      answer_index: q.answer_index,
      explanation: q.explanation,
    })));
    await storeSection(lessonId, "quiz", { questions });

    await pool.query(
      `UPDATE lessons SET status = 'ready', cost_usd = $2, generated_at = now() WHERE id = $1`,
      [lessonId, totalCost],
    );
  } catch (err) {
    try {
      await pool.query(
        `UPDATE lessons SET status = 'failed', error = $2, cost_usd = $3 WHERE id = $1`,
        [lessonId, err instanceof Error ? err.message.slice(0, 1000) : String(err), totalCost],
      );
    } catch (writeErr) {
      console.error("generateLessonInto: failed to record failure", lessonId, writeErr);
    }
  }
}

// Auto mode: let the model pick 1–3 catalog points for the theme, and persist
// them. Manual mode: load the points the owner chose.
async function resolvePoints(
  lessonId: string,
  lesson: LessonRow,
  addCost: (c: number) => void,
): Promise<GrammarPoint[]> {
  if (lesson.mode === "auto") {
    const candidates = await listGrammarPoints(lesson.jlpt_level as JlptLevel);
    const sel = await generateGrammarSelection({
      theme: lesson.topic,
      jlpt_level: lesson.jlpt_level,
      candidates: candidates.map((c) => ({ id: c.id, title: c.title, meaning: c.meaning })),
    });
    addCost(computeCost(sel.usage));
    const byId = new Map(candidates.map((c) => [c.id, c]));
    let points = sel.ids.map((id) => byId.get(id)).filter((p): p is GrammarPoint => Boolean(p)).slice(0, 3);
    if (points.length === 0 && candidates[0]) points = [candidates[0]];
    await pool.query(`UPDATE lessons SET grammar_point_ids = $2 WHERE id = $1`, [lessonId, points.map((p) => p.id)]);
    return points;
  }
  return getGrammarPointsByIds(lesson.grammar_point_ids);
}

// Tag already-inserted items and link them to the lesson at a section+position.
async function linkItems(lessonId: string, items: ItemRecord[], section: string): Promise<void> {
  const tag = `lesson:${lessonId}`;
  for (const [i, item] of items.entries()) {
    await pool.query(
      `UPDATE items SET tags = array_append(tags, $2) WHERE id = $1 AND NOT ($2 = ANY(tags))`,
      [item.id, tag],
    );
    await pool.query(
      `INSERT INTO lesson_items (lesson_id, item_id, section, position)
       VALUES ($1, $2, $3, $4) ON CONFLICT (lesson_id, item_id) DO NOTHING`,
      [lessonId, item.id, section, i],
    );
  }
}

async function storeSection(lessonId: string, section: string, content: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO lesson_sections (lesson_id, section, content)
     VALUES ($1, $2, $3) ON CONFLICT (lesson_id, section) DO UPDATE SET content = EXCLUDED.content`,
    [lessonId, section, JSON.stringify(content)],
  );
}

// Store a lesson-only synthetic item (reading/listening) in lesson_sections. It
// carries a generated id but is NEVER inserted into `items`, so it stays out of
// the SRS review queue.
async function storeSyntheticBlock(
  lessonId: string,
  section: string,
  skill: string,
  enr: { prompt: unknown; answer: unknown },
): Promise<void> {
  const item: ItemRecord = {
    id: randomUUID(),
    skill: skill as ItemRecord["skill"],
    prompt: enr.prompt,
    answer: enr.answer,
    source: "ai",
    tags: [],
    created_at: new Date().toISOString(),
  };
  await storeSection(lessonId, section, { item });
}
