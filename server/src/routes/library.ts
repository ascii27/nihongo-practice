import { Router } from "express";
import type { Skill, TagRef } from "@nihongo/shared";
import { pool } from "../db/pool.js";
import { itemDisplay, boxToMastery } from "../services/item-display.js";
import { parseFocus, focusClause } from "../services/focus.js";
import { userTagsSql } from "../services/tags.js";

export const libraryRouter = Router();

export const LIBRARY_PAGE = 50;

type Row = {
  id: string; skill: Skill; prompt: unknown; answer: unknown; box: number | null;
  user_tags: TagRef[]; total: number;
};

// GET /api/library?q=&skill=&tag=&offset= — one page of cards for Library,
// newest first (most recently tagged first when filtering by tag). Search is a
// case-insensitive substring over the stored prompt/answer JSON — known-naive;
// better search is a separate piece of work.
libraryRouter.get("/", async (req, res) => {
  const parsed = await parseFocus(req.query);
  if (!parsed.ok) {
    res.status(parsed.status).json(parsed.body);
    return;
  }
  const { focus } = parsed;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const offset = Math.max(0, Math.floor(Number(req.query.offset ?? 0)) || 0);

  const params: unknown[] = [LIBRARY_PAGE, offset];
  let search = "";
  if (q) {
    params.push(q);
    search = ` AND (i.prompt::text ILIKE '%' || $3 || '%' OR i.answer::text ILIKE '%' || $3 || '%')`;
  }
  const f = focusClause(focus, params.length + 1);
  params.push(...f.params);
  // focusClause pushes the tag last, so when a tag is set it is the final param.
  const order = focus.tag
    ? `(SELECT ot.added_at FROM item_tags ot WHERE ot.item_id = i.id AND ot.tag_id = $${params.length}) DESC, i.created_at DESC`
    : `i.created_at DESC`;

  const r = await pool.query<Row>(
    `SELECT i.id, i.skill, i.prompt, i.answer, rs.box, ${userTagsSql("i")} AS user_tags,
            count(*) OVER ()::int AS total
       FROM items i LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE true ${search} ${f.sql}
      ORDER BY ${order}
      LIMIT $1 OFFSET $2`,
    params,
  );

  const total = r.rows[0]?.total ?? 0;
  res.json({
    items: r.rows.map((row) => {
      const d = itemDisplay(row.skill, row.prompt, row.answer);
      return {
        id: row.id, skill: row.skill, front: d.front, reading: d.reading, meaning: d.meaning,
        mastery: boxToMastery(row.box), user_tags: row.user_tags,
      };
    }),
    total,
    next_offset: offset + r.rows.length < total ? offset + r.rows.length : null,
  });
});
