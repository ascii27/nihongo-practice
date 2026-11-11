import { randomUUID } from "node:crypto";
import {
  toRubyHtml, readingFor, computeCost,
  generateManualVocab, generateManualGrammar,
} from "@nihongo/gen";
import { pool } from "../db/pool.js";
import type {
  TagSummary, TagRef, LibraryItem,
  QuickAddItemRequest, QuickAddPreviewRequest, QuickAddPreviewResponse, Skill,
} from "@nihongo/shared";
import { itemDisplay, boxToMastery } from "./item-display.js";

// SQL expression yielding an item's learner-facing tags as a JSON array of
// {id, name}, sorted by name. `alias` is the items alias in the outer query.
export function userTagsSql(alias: string): string {
  return `COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
                      FROM item_tags it JOIN tags t ON t.id = it.tag_id
                     WHERE it.item_id = ${alias}.id), '[]'::json)`;
}

type SummaryRow = {
  id: string; name: string; description: string; created_at: Date; item_count: number; mastery_sum: number;
};

// Average mastery uses the same box→mastery mapping as item-display
// (box/5, never-studied = 0), computed in SQL so it covers every member.
const SUMMARY_SELECT = `
  SELECT t.id, t.name, t.description, t.created_at,
         count(it.item_id)::int AS item_count,
         COALESCE(sum(LEAST(COALESCE(rs.box, 0), 5) / 5.0), 0)::float AS mastery_sum
    FROM tags t
    LEFT JOIN item_tags it ON it.tag_id = t.id
    LEFT JOIN review_state rs ON rs.item_id = it.item_id`;

function toSummary(r: SummaryRow): TagSummary {
  return {
    id: r.id, name: r.name, description: r.description,
    item_count: r.item_count,
    avg_mastery: r.item_count === 0 ? 0 : r.mastery_sum / r.item_count,
    created_at: r.created_at.toISOString(),
  };
}

export async function listTags(): Promise<TagSummary[]> {
  const r = await pool.query<SummaryRow>(`${SUMMARY_SELECT} GROUP BY t.id ORDER BY lower(t.name)`);
  return r.rows.map(toSummary);
}

export async function tagExists(id: string): Promise<boolean> {
  const r = await pool.query(`SELECT 1 FROM tags WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

// Raised when a create/rename would collide with an existing name
// (case- and surrounding-whitespace-insensitive, enforced by a unique index).
export class TagExistsError extends Error {}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export async function createTag(name: string, description: string): Promise<{ id: string }> {
  try {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO tags (name, description) VALUES (btrim($1), $2) RETURNING id`, [name, description],
    );
    return { id: r.rows[0]!.id };
  } catch (err) {
    if (isUniqueViolation(err)) throw new TagExistsError(name);
    throw err;
  }
}

export async function updateTag(id: string, patch: { name?: string; description?: string }): Promise<boolean> {
  try {
    const r = await pool.query(
      `UPDATE tags SET name = COALESCE(btrim($2), name), description = COALESCE($3, description) WHERE id = $1`,
      [id, patch.name ?? null, patch.description ?? null],
    );
    return (r.rowCount ?? 0) > 0;
  } catch (err) {
    if (isUniqueViolation(err)) throw new TagExistsError(patch.name ?? "");
    throw err;
  }
}

// Removes the label only: item_tags rows cascade, items and review_state stay.
export async function deleteTag(id: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM tags WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

export async function tagItem(tagId: string, itemId: string): Promise<"ok" | "no_tag" | "no_item"> {
  if (!(await tagExists(tagId))) return "no_tag";
  const item = await pool.query(`SELECT 1 FROM items WHERE id = $1`, [itemId]);
  if ((item.rowCount ?? 0) === 0) return "no_item";
  await pool.query(
    `INSERT INTO item_tags (tag_id, item_id) VALUES ($1, $2) ON CONFLICT (tag_id, item_id) DO NOTHING`,
    [tagId, itemId],
  );
  return "ok";
}

export async function untagItem(tagId: string, itemId: string): Promise<void> {
  await pool.query(`DELETE FROM item_tags WHERE tag_id = $1 AND item_id = $2`, [tagId, itemId]);
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
  req: QuickAddItemRequest,
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
export async function previewQuickItem(req: QuickAddPreviewRequest): Promise<QuickAddPreviewResponse> {
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

// Create a new user item from the (edited) preview and tag it, in one
// transaction. Null when the tag doesn't exist.
export async function quickAddItem(tagId: string, req: QuickAddItemRequest): Promise<{ item_id: string } | null> {
  const built = await buildQuickItem(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tag = await client.query(`SELECT 1 FROM tags WHERE id = $1`, [tagId]);
    if ((tag.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const ir = await client.query<{ id: string }>(
      `INSERT INTO items (skill, prompt, answer, source, external_id)
       VALUES ($1, $2, $3, 'user', $4) RETURNING id`,
      [built.skill, JSON.stringify(built.prompt), JSON.stringify(built.answer), `user-${randomUUID()}`],
    );
    const itemId = ir.rows[0]!.id;
    await client.query(`INSERT INTO item_tags (tag_id, item_id) VALUES ($1, $2)`, [tagId, itemId]);
    await client.query("COMMIT");
    return { item_id: itemId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

type CandidateRow = {
  id: string; skill: string; prompt: unknown; answer: unknown; box: number | null; user_tags: TagRef[];
};

// Items NOT already carrying the tag, for "search & add". Matches `q` as a
// case-insensitive substring of the stored prompt/answer JSON. Capped at 30.
export async function searchCandidates(tagId: string, q: string, skill?: string): Promise<LibraryItem[]> {
  const params: unknown[] = [tagId, q];
  let skillClause = "";
  if (skill) {
    params.push(skill);
    skillClause = `AND i.skill = $${params.length}`;
  }
  const r = await pool.query<CandidateRow>(
    `SELECT i.id, i.skill, i.prompt, i.answer, rs.box, ${userTagsSql("i")} AS user_tags
       FROM items i
       LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE (i.prompt::text ILIKE '%' || $2 || '%' OR i.answer::text ILIKE '%' || $2 || '%')
        ${skillClause}
        AND NOT EXISTS (SELECT 1 FROM item_tags it WHERE it.tag_id = $1 AND it.item_id = i.id)
      ORDER BY i.created_at DESC
      LIMIT 30`,
    params,
  );
  return r.rows.map((row) => {
    const d = itemDisplay(row.skill as Skill, row.prompt, row.answer);
    return {
      id: row.id, skill: row.skill as Skill,
      front: d.front, reading: d.reading, meaning: d.meaning,
      mastery: boxToMastery(row.box), user_tags: row.user_tags,
    };
  });
}
