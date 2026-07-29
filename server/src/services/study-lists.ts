import { randomUUID } from "node:crypto";
import {
  toRubyHtml, readingFor, computeCost,
  generateManualVocab, generateManualGrammar,
} from "@nihongo/gen";
import { pool } from "../db/pool.js";
import type {
  StudyListSummary, StudyListDetail, LibraryItem, ItemRecord,
  QuickAddStudyItemRequest, StudyPreviewRequest, StudyPreviewResponse, Skill,
} from "@nihongo/shared";
import { itemDisplay, boxToMastery } from "./item-display.js";

type SummaryRow = {
  id: string; title: string; description: string; created_at: Date; item_count: string;
};

function toSummary(r: SummaryRow): StudyListSummary {
  return {
    id: r.id, title: r.title, description: r.description,
    item_count: Number(r.item_count), created_at: r.created_at.toISOString(),
  };
}

const SUMMARY_SELECT = `
  SELECT sl.id, sl.title, sl.description, sl.created_at,
         (SELECT count(*) FROM study_list_items li WHERE li.list_id = sl.id)::text AS item_count
    FROM study_lists sl`;

export async function listStudyLists(): Promise<StudyListSummary[]> {
  const r = await pool.query<SummaryRow>(`${SUMMARY_SELECT} ORDER BY sl.created_at DESC`);
  return r.rows.map(toSummary);
}

export async function createStudyList(title: string, description: string): Promise<{ id: string }> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO study_lists (title, description) VALUES ($1, $2) RETURNING id`,
    [title, description],
  );
  return { id: r.rows[0]!.id };
}

export async function deleteStudyList(id: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM study_lists WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

// The join query used by both detail (display rows + mastery) and cram (raw
// item records). Ordered by the user's chosen position.
const MEMBER_SELECT = `
  SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.external_id, i.tags, i.created_at,
         rs.box
    FROM study_list_items li
    JOIN items i ON i.id = li.item_id
    LEFT JOIN review_state rs ON rs.item_id = i.id
   WHERE li.list_id = $1
   ORDER BY li.position ASC, li.added_at ASC`;

type MemberRow = {
  id: string; skill: string; prompt: unknown; answer: unknown; source: string;
  external_id: string | null; tags: string[]; created_at: Date; box: number | null;
};

export async function getStudyListDetail(id: string): Promise<StudyListDetail | null> {
  const hr = await pool.query<SummaryRow>(`${SUMMARY_SELECT} WHERE sl.id = $1`, [id]);
  const header = hr.rows[0];
  if (!header) return null;

  const mr = await pool.query<MemberRow>(MEMBER_SELECT, [id]);
  const items: LibraryItem[] = mr.rows.map((row) => {
    const d = itemDisplay(row.skill as Skill, row.prompt, row.answer);
    return {
      id: row.id, skill: row.skill as Skill,
      front: d.front, reading: d.reading, meaning: d.meaning,
      mastery: boxToMastery(row.box),
    };
  });
  return { ...toSummary(header), items };
}

// Cram: all members as review items, shuffled, schedule ignored.
export async function getCramItems(id: string): Promise<ItemRecord[]> {
  const mr = await pool.query<MemberRow>(
    `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.external_id, i.tags, i.created_at, rs.box
       FROM study_list_items li
       JOIN items i ON i.id = li.item_id
       LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE li.list_id = $1
      ORDER BY random()`,
    [id],
  );
  return mr.rows.map((row) => ({
    id: row.id, skill: row.skill as Skill, prompt: row.prompt, answer: row.answer,
    source: row.source as ItemRecord["source"], external_id: row.external_id,
    tags: row.tags, created_at: row.created_at.toISOString(),
  }));
}

// Add an existing item. Appends at the end (max position + 1). Idempotent.
export async function addItem(listId: string, itemId: string): Promise<"added" | "exists" | "no_list" | "no_item"> {
  const list = await pool.query(`SELECT 1 FROM study_lists WHERE id = $1`, [listId]);
  if ((list.rowCount ?? 0) === 0) return "no_list";
  const item = await pool.query(`SELECT 1 FROM items WHERE id = $1`, [itemId]);
  if ((item.rowCount ?? 0) === 0) return "no_item";
  const r = await pool.query(
    `INSERT INTO study_list_items (list_id, item_id, position)
     VALUES ($1, $2, (SELECT COALESCE(MAX(position), -1) + 1 FROM study_list_items WHERE list_id = $1))
     ON CONFLICT (list_id, item_id) DO NOTHING`,
    [listId, itemId],
  );
  return (r.rowCount ?? 0) > 0 ? "added" : "exists";
}

export async function removeItem(listId: string, itemId: string): Promise<boolean> {
  const r = await pool.query(
    `DELETE FROM study_list_items WHERE list_id = $1 AND item_id = $2`,
    [listId, itemId],
  );
  return (r.rowCount ?? 0) > 0;
}

// Build the prompt/answer JSON for a quick-added item, per kind. Offline: vocab
// furigana/reading come from the local tokenizer; kanji reads from the seeded
// reference table. The (already edited) fields arrive from the preview step.
type KanjiRef = { meanings: string[]; on_yomi: string[]; kun_yomi: string[]; stroke_count: number };

async function lookupKanji(character: string): Promise<KanjiRef | null> {
  const ref = await pool.query<KanjiRef>(
    `SELECT meanings, on_yomi, kun_yomi, stroke_count FROM kanji WHERE character = $1`,
    [character],
  );
  return ref.rows[0] ?? null;
}

async function buildQuickItem(
  req: QuickAddStudyItemRequest,
): Promise<{ skill: Skill; prompt: object; answer: object }> {
  if (req.kind === "vocab") {
    const sentence_ruby = await toRubyHtml(req.sentence_japanese);
    const reading = await readingFor(req.japanese);
    return {
      skill: "vocab",
      prompt: { sentence_ruby, target: req.japanese, sentence_english: req.sentence_english },
      answer: { meaning: req.english, reading },
    };
  }
  if (req.kind === "kanji") {
    const k = await lookupKanji(req.character);
    // The user may have edited the meaning; readings/strokes stay authoritative
    // from the reference table.
    const meanings = req.meaning
      ? req.meaning.split(",").map((m) => m.trim()).filter(Boolean)
      : k?.meanings ?? [];
    return {
      skill: "kanji",
      prompt: { character: req.character },
      answer: {
        meanings,
        on: k?.on_yomi ?? [],
        kun: k?.kun_yomi ?? [],
        stroke_count: k?.stroke_count ?? 0,
      },
    };
  }
  // grammar
  const sentence_ruby = req.sentence_japanese ? await toRubyHtml(req.sentence_japanese) : "";
  return {
    skill: "grammar",
    prompt: { sentence_ruby, pattern: req.pattern, sentence_english: req.sentence_english },
    answer: { explanation: req.explanation },
  };
}

// Generate editable fields from a raw input (no DB write). Vocab & grammar use
// the AI; kanji fills meaning + readings from the reference table.
export async function previewQuickItem(req: StudyPreviewRequest): Promise<StudyPreviewResponse> {
  const input = req.input.trim();
  if (req.kind === "vocab") {
    const { item, usage } = await generateManualVocab({ input });
    return { kind: "vocab", ...item, cost_usd: computeCost(usage) };
  }
  if (req.kind === "grammar") {
    const { item, usage } = await generateManualGrammar({ input });
    return { kind: "grammar", ...item, cost_usd: computeCost(usage) };
  }
  // kanji — from the reference table, no AI.
  const character = input.slice(0, 4);
  const k = await lookupKanji(character);
  return {
    kind: "kanji",
    character,
    meaning: k ? k.meanings.join(", ") : "",
    readings: k ? [...k.on_yomi, ...k.kun_yomi].filter(Boolean).join("、") : "",
    cost_usd: 0,
  };
}

// Create a new user item from raw input and add it to the list, in one
// transaction. Returns the new item id.
export async function quickAddItem(
  listId: string,
  req: QuickAddStudyItemRequest,
): Promise<{ item_id: string } | null> {
  const built = await buildQuickItem(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const list = await client.query(`SELECT 1 FROM study_lists WHERE id = $1`, [listId]);
    if ((list.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const externalId = `user-${randomUUID()}`;
    const ir = await client.query<{ id: string }>(
      `INSERT INTO items (skill, prompt, answer, source, external_id)
       VALUES ($1, $2, $3, 'user', $4) RETURNING id`,
      [built.skill, JSON.stringify(built.prompt), JSON.stringify(built.answer), externalId],
    );
    const itemId = ir.rows[0]!.id;
    await client.query(
      `INSERT INTO study_list_items (list_id, item_id, position)
       VALUES ($1, $2, (SELECT COALESCE(MAX(position), -1) + 1 FROM study_list_items WHERE list_id = $1))`,
      [listId, itemId],
    );
    await client.query("COMMIT");
    return { item_id: itemId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Search items NOT already in the list, for "search & add". Matches the
// character/front text or meaning via a simple case-insensitive substring over
// the stored JSON. Capped.
export async function searchCandidates(
  listId: string,
  q: string,
  skill?: string,
): Promise<LibraryItem[]> {
  const params: unknown[] = [listId, q];
  let skillClause = "";
  if (skill) {
    params.push(skill);
    skillClause = `AND i.skill = $${params.length}`;
  }
  const r = await pool.query<MemberRow>(
    `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.external_id, i.tags, i.created_at,
            rs.box
       FROM items i
       LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE (i.prompt::text ILIKE '%' || $2 || '%' OR i.answer::text ILIKE '%' || $2 || '%')
        ${skillClause}
        AND NOT EXISTS (SELECT 1 FROM study_list_items li WHERE li.list_id = $1 AND li.item_id = i.id)
      ORDER BY i.created_at DESC
      LIMIT 30`,
    params,
  );
  return r.rows.map((row) => {
    const d = itemDisplay(row.skill as Skill, row.prompt, row.answer);
    return {
      id: row.id, skill: row.skill as Skill,
      front: d.front, reading: d.reading, meaning: d.meaning,
      mastery: boxToMastery(row.box),
    };
  });
}
