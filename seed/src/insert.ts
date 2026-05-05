import type { Pool } from "pg";

export type InsertItem = {
  external_id: string;
  prompt: { sentence_ruby: string; target: string; sentence_english: string };
  answer: { meaning: string; reading: string };
};

export async function insertSeedItems(pool: Pool, items: InsertItem[]): Promise<{ inserted: number; skipped: number }> {
  if (items.length === 0) return { inserted: 0, skipped: 0 };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0;
    for (const it of items) {
      const r = await client.query(
        `INSERT INTO items (skill, prompt, answer, source, external_id)
         VALUES ('vocab', $1, $2, 'seed', $3)
         ON CONFLICT (source, external_id) DO NOTHING`,
        [JSON.stringify(it.prompt), JSON.stringify(it.answer), it.external_id],
      );
      if ((r.rowCount ?? 0) > 0) inserted += 1;
    }
    await client.query("COMMIT");
    return { inserted, skipped: items.length - inserted };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
