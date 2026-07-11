import { pool } from "../db/pool.js";
import type {
  CreateLessonRequest, LessonSummary, LessonDetail, LessonBlock,
  DialogLine, TodayLessonResponse, LessonStateUpdate, ItemRecord, GrammarPoint, Skill,
} from "@nihongo/shared";
import { getGrammarPointsByIds } from "./grammar-points.js";

// A lesson's display title: the theme (auto) or the joined grammar point titles
// (manual). Capped so it fits the UI.
export function titleFrom(input: CreateLessonRequest, manualPoints: GrammarPoint[]): string {
  if (input.mode === "auto") return input.theme.trim().slice(0, 120);
  const joined = manualPoints.map((p) => p.title).join("、");
  return (joined || "Lesson").slice(0, 120);
}

export async function createLesson(input: CreateLessonRequest): Promise<{ id: string }> {
  const manualPoints = input.mode === "manual" ? await getGrammarPointsByIds(input.grammar_point_ids) : [];
  const title = titleFrom(input, manualPoints);
  const topic = input.mode === "auto" ? input.theme : title;
  const grammarIds = input.mode === "manual" ? input.grammar_point_ids : [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query<{ id: string }>(
      `INSERT INTO lessons (title, topic, jlpt_level, mode, grammar_point_ids, status)
       VALUES ($1, $2, $3, $4, $5, 'generating') RETURNING id`,
      [title, topic, input.jlpt_level, input.mode, grammarIds],
    );
    const id = r.rows[0]!.id;
    await client.query(`INSERT INTO lesson_state (lesson_id) VALUES ($1)`, [id]);
    await client.query("COMMIT");
    return { id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

type SummaryRow = {
  id: string; title: string; topic: string; jlpt_level: string; kind: string;
  status: string; created_at: Date; progress: string; item_count: string;
};

function toSummary(r: SummaryRow): LessonSummary {
  return {
    id: r.id, title: r.title, topic: r.topic, jlpt_level: r.jlpt_level,
    kind: r.kind as LessonSummary["kind"], status: r.status as LessonSummary["status"],
    progress: r.progress as LessonSummary["progress"],
    item_count: Number(r.item_count), created_at: r.created_at.toISOString(),
  };
}

const SUMMARY_SELECT = `
  SELECT l.id, l.title, l.topic, l.jlpt_level, l.kind, l.status, l.created_at,
         ls.status AS progress,
         (SELECT count(*) FROM lesson_items li WHERE li.lesson_id = l.id)::text AS item_count
    FROM lessons l JOIN lesson_state ls ON ls.lesson_id = l.id`;

export async function listLessons(): Promise<LessonSummary[]> {
  const r = await pool.query<SummaryRow>(`${SUMMARY_SELECT} ORDER BY l.created_at DESC`);
  return r.rows.map(toSummary);
}

export async function resolveToday(): Promise<TodayLessonResponse> {
  const inProg = await pool.query<SummaryRow>(
    `${SUMMARY_SELECT} WHERE ls.status = 'in_progress' AND l.status = 'ready'
     ORDER BY l.created_at ASC LIMIT 1`,
  );
  if (inProg.rows[0]) return { lesson: toSummary(inProg.rows[0]), generating: false };

  const next = await pool.query<SummaryRow>(
    `${SUMMARY_SELECT} WHERE ls.status = 'not_started' AND l.status = 'ready'
     ORDER BY l.created_at ASC LIMIT 1`,
  );
  const generating = ((await pool.query(
    `SELECT 1 FROM lessons WHERE status = 'generating' LIMIT 1`,
  )).rowCount ?? 0) > 0;

  return { lesson: next.rows[0] ? toSummary(next.rows[0]) : null, generating };
}

type DetailRow = {
  id: string; title: string; topic: string; jlpt_level: string; mode: string;
  status: string; progress: string; current_section: string | null;
  grammar_point_ids: string[];
};

type GrammarContent = {
  point: { id: string; title: string; romaji: string | null; meaning: string };
  dialog: DialogLine[];
  explanation: string;
};

export async function getLessonDetail(id: string): Promise<LessonDetail | null> {
  const lr = await pool.query<DetailRow>(
    `SELECT l.id, l.title, l.topic, l.jlpt_level, l.mode, l.status, l.grammar_point_ids,
            ls.status AS progress, ls.current_section
       FROM lessons l JOIN lesson_state ls ON ls.lesson_id = l.id
      WHERE l.id = $1`,
    [id],
  );
  const lesson = lr.rows[0];
  if (!lesson) return null;

  // SRS items grouped by section (vocab / quiz / cloze).
  const ir = await pool.query<{
    section: string; id: string; skill: string; prompt: unknown; answer: unknown;
    source: string; external_id: string | null; tags: string[]; created_at: Date;
  }>(
    `SELECT li.section, i.id, i.skill, i.prompt, i.answer, i.source, i.external_id, i.tags, i.created_at
       FROM lesson_items li JOIN items i ON i.id = li.item_id
      WHERE li.lesson_id = $1
      ORDER BY li.section, li.position ASC`,
    [id],
  );
  const itemsBySection = new Map<string, ItemRecord[]>();
  for (const row of ir.rows) {
    const rec: ItemRecord = {
      id: row.id, skill: row.skill as Skill, prompt: row.prompt, answer: row.answer,
      source: row.source as ItemRecord["source"], external_id: row.external_id,
      tags: row.tags, created_at: row.created_at.toISOString(),
    };
    const arr = itemsBySection.get(row.section) ?? [];
    arr.push(rec);
    itemsBySection.set(row.section, arr);
  }

  // Teaching / lesson-only content keyed by section (grammar:<id>, reading, listening).
  const sr = await pool.query<{ section: string; content: unknown }>(
    `SELECT section, content FROM lesson_sections WHERE lesson_id = $1`,
    [id],
  );
  const contentBySection = new Map<string, unknown>(sr.rows.map((row) => [row.section, row.content]));

  // Assemble ordered blocks: grammar (per point) → vocab → reading → listening
  // → quiz → cloze. A block is only emitted if its content exists.
  const blocks: LessonBlock[] = [];
  for (const gid of lesson.grammar_point_ids) {
    const c = contentBySection.get(`grammar:${gid}`) as GrammarContent | undefined;
    if (c) blocks.push({ type: "grammar", point: c.point, dialog: c.dialog, explanation: c.explanation });
  }
  const vocab = itemsBySection.get("vocab");
  if (vocab?.length) blocks.push({ type: "vocab", items: vocab });
  const reading = contentBySection.get("reading") as { item: ItemRecord } | undefined;
  if (reading) blocks.push({ type: "reading", item: reading.item });
  const listening = contentBySection.get("listening") as { item: ItemRecord } | undefined;
  if (listening) blocks.push({ type: "listening", item: listening.item });
  const quiz = itemsBySection.get("quiz");
  if (quiz?.length) blocks.push({ type: "quiz", items: quiz });
  const cloze = itemsBySection.get("cloze");
  if (cloze?.length) blocks.push({ type: "cloze", items: cloze });

  return {
    id: lesson.id, title: lesson.title, topic: lesson.topic, jlpt_level: lesson.jlpt_level,
    mode: lesson.mode as LessonDetail["mode"],
    status: lesson.status as LessonDetail["status"], progress: lesson.progress as LessonDetail["progress"],
    current_section: lesson.current_section,
    blocks,
  };
}

export async function updateLessonState(id: string, u: LessonStateUpdate): Promise<void> {
  await pool.query(
    `UPDATE lesson_state
        SET status = $2,
            current_section = $3,
            current_index = $4,
            started_at = COALESCE(started_at, CASE WHEN $2 <> 'not_started' THEN now() END),
            completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END
      WHERE lesson_id = $1`,
    [id, u.progress, u.current_section, u.current_index],
  );
}
