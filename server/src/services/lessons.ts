import { pool } from "../db/pool.js";
import type {
  CreateLessonRequest, LessonSummary, LessonDetail, LessonSectionDetail,
  TodayLessonResponse, LessonStateUpdate, ItemRecord, Skill, LessonTeaching,
} from "@nihongo/shared";

export function titleFor(topic: string): string {
  return topic.trim().slice(0, 120);
}

export async function createLesson(input: CreateLessonRequest): Promise<{ id: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query<{ id: string }>(
      `INSERT INTO lessons (title, topic, jlpt_level, skills, status)
       VALUES ($1, $2, $3, $4, 'generating') RETURNING id`,
      [titleFor(input.topic), input.topic, input.jlpt_level, input.skills],
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

type LessonRow = {
  id: string; title: string; topic: string; jlpt_level: string; kind: string;
  status: string; skills: string[]; created_at: Date;
  progress: string; current_section: string | null; item_count: string;
};

function toSummary(r: LessonRow): LessonSummary {
  return {
    id: r.id, title: r.title, topic: r.topic, jlpt_level: r.jlpt_level,
    kind: r.kind as LessonSummary["kind"], status: r.status as LessonSummary["status"],
    progress: r.progress as LessonSummary["progress"],
    item_count: Number(r.item_count), created_at: r.created_at.toISOString(),
  };
}

const LIST_SELECT = `
  SELECT l.id, l.title, l.topic, l.jlpt_level, l.kind, l.status, l.skills, l.created_at,
         ls.status AS progress, ls.current_section,
         (SELECT count(*) FROM lesson_items li WHERE li.lesson_id = l.id)::text AS item_count
    FROM lessons l JOIN lesson_state ls ON ls.lesson_id = l.id`;

export async function listLessons(): Promise<LessonSummary[]> {
  const r = await pool.query<LessonRow>(`${LIST_SELECT} ORDER BY l.created_at DESC`);
  return r.rows.map(toSummary);
}

export async function getLessonDetail(id: string): Promise<LessonDetail | null> {
  const lr = await pool.query<LessonRow>(`${LIST_SELECT} WHERE l.id = $1`, [id]);
  const lesson = lr.rows[0];
  if (!lesson) return null;

  const ir = await pool.query<{
    section: string; position: number;
    id: string; skill: string; prompt: unknown; answer: unknown;
    source: string; external_id: string | null; tags: string[]; created_at: Date;
  }>(
    `SELECT li.section, li.position,
            i.id, i.skill, i.prompt, i.answer, i.source, i.external_id, i.tags, i.created_at
       FROM lesson_items li JOIN items i ON i.id = li.item_id
      WHERE li.lesson_id = $1
      ORDER BY li.position ASC`,
    [id],
  );

  const bySection = new Map<string, ItemRecord[]>();
  for (const row of ir.rows) {
    const rec: ItemRecord = {
      id: row.id, skill: row.skill as Skill, prompt: row.prompt, answer: row.answer,
      source: row.source as ItemRecord["source"], external_id: row.external_id,
      tags: row.tags, created_at: row.created_at.toISOString(),
    };
    const arr = bySection.get(row.section) ?? [];
    arr.push(rec);
    bySection.set(row.section, arr);
  }
  const tr = await pool.query<{ section: string; content: LessonTeaching }>(
    `SELECT section, content FROM lesson_sections WHERE lesson_id = $1`, [id],
  );
  const teachingBySection = new Map<string, LessonTeaching>(
    tr.rows.map((row) => [row.section, row.content]),
  );

  // Sections in the lesson's declared skill order, only those with items.
  const sections: LessonSectionDetail[] = (lesson.skills as Skill[])
    .filter((s) => bySection.has(s))
    .map((s) => ({ section: s, items: bySection.get(s)!, teaching: teachingBySection.get(s) ?? null }));

  return {
    id: lesson.id, title: lesson.title, topic: lesson.topic, jlpt_level: lesson.jlpt_level,
    status: lesson.status as LessonDetail["status"], progress: lesson.progress as LessonDetail["progress"],
    current_section: lesson.current_section,
    sections,
  };
}

export async function resolveToday(): Promise<TodayLessonResponse> {
  const inProg = await pool.query<LessonRow>(
    `${LIST_SELECT} WHERE ls.status = 'in_progress' AND l.status = 'ready'
     ORDER BY l.created_at ASC LIMIT 1`,
  );
  if (inProg.rows[0]) return { lesson: toSummary(inProg.rows[0]), generating: false };

  const next = await pool.query<LessonRow>(
    `${LIST_SELECT} WHERE ls.status = 'not_started' AND l.status = 'ready'
     ORDER BY l.created_at ASC LIMIT 1`,
  );
  const generating = ((await pool.query(
    `SELECT 1 FROM lessons WHERE status = 'generating' LIMIT 1`,
  )).rowCount ?? 0) > 0;

  return { lesson: next.rows[0] ? toSummary(next.rows[0]) : null, generating };
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
