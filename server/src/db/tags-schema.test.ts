import { describe, it, expect, beforeEach } from "vitest";
import { pool } from "./pool.js";
import { resetDb } from "./reset.js";

beforeEach(async () => { await resetDb(); });

async function insertItem(): Promise<string> {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source) VALUES ('vocab', '{}', '{}', 'seed') RETURNING id`,
  );
  return r.rows[0].id;
}

describe("tags schema", () => {
  it("stores a tag with members", async () => {
    const t = await pool.query(`INSERT INTO tags (name) VALUES ('Coto Academy') RETURNING id`);
    const itemId = await insertItem();
    await pool.query(`INSERT INTO item_tags (tag_id, item_id) VALUES ($1, $2)`, [t.rows[0].id, itemId]);
    const r = await pool.query(`SELECT count(*)::int AS c FROM item_tags WHERE item_id = $1`, [itemId]);
    expect(r.rows[0].c).toBe(1);
  });

  it("rejects a name differing only by case and surrounding whitespace", async () => {
    await pool.query(`INSERT INTO tags (name) VALUES ('Coto Academy')`);
    await expect(pool.query(`INSERT INTO tags (name) VALUES ('  coto academy ')`))
      .rejects.toMatchObject({ code: "23505" });
  });

  it("deleting a tag keeps the item", async () => {
    const t = await pool.query(`INSERT INTO tags (name) VALUES ('X') RETURNING id`);
    const itemId = await insertItem();
    await pool.query(`INSERT INTO item_tags (tag_id, item_id) VALUES ($1, $2)`, [t.rows[0].id, itemId]);
    await pool.query(`DELETE FROM tags WHERE id = $1`, [t.rows[0].id]);
    const r = await pool.query(`SELECT count(*)::int AS c FROM items WHERE id = $1`, [itemId]);
    expect(r.rows[0].c).toBe(1);
  });

  it("sessions can record a tag filter", async () => {
    const t = await pool.query(`INSERT INTO tags (name) VALUES ('X') RETURNING id`);
    const s = await pool.query(`INSERT INTO sessions (tag_filter) VALUES ($1) RETURNING tag_filter`, [t.rows[0].id]);
    expect(s.rows[0].tag_filter).toBe(t.rows[0].id);
  });
});
