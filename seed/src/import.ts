import "dotenv/config";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  generateSentencesForCards,
  toRubyHtml,
  readingFor,
  computeCost,
} from "@nihongo/gen";
import { parseDeckXml } from "./parse-xml.js";
import { insertSeedItems, type InsertItem } from "./insert.js";

const BATCH_SIZE = 20;

async function main() {
  const xmlPath = process.argv[2];
  if (!xmlPath) {
    console.error("usage: tsx src/import.ts <path-to-deck.xml>");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");

  const xml = readFileSync(xmlPath, "utf8");
  const allCards = parseDeckXml(xml);
  console.log(`parsed ${allCards.length} cards from ${xmlPath}`);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const existingRes = await pool.query<{ external_id: string }>(
    `SELECT external_id FROM items WHERE source='seed' AND external_id = ANY($1::text[])`,
    [allCards.map((c) => c.external_id)],
  );
  const existing = new Set(existingRes.rows.map((r) => r.external_id));
  const cards = allCards.filter((c) => !existing.has(c.external_id));
  console.log(`${existing.size} already seeded; ${cards.length} to import`);

  let totalInserted = 0;
  let totalSkipped = existing.size;
  let totalFailedBatches = 0;
  let totalCost = 0;

  for (let i = 0; i < cards.length; i += BATCH_SIZE) {
    const batch = cards.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(cards.length / BATCH_SIZE);
    console.log(`batch ${batchNum}/${totalBatches} (${batch.length} cards)…`);
    try {
      const result = await generateSentencesForCards(batch);
      totalCost += computeCost(result.usage);

      const items: InsertItem[] = [];
      const byId = new Map(result.sentences.map((s) => [s.external_id, s]));
      for (const card of batch) {
        const sent = byId.get(card.external_id);
        if (!sent) {
          console.warn(`  missing sentence for ${card.external_id}, skipping`);
          continue;
        }
        const sentence_ruby = await toRubyHtml(sent.sentence_japanese);
        const reading = await readingFor(card.japanese);
        items.push({
          external_id: card.external_id,
          prompt: {
            sentence_ruby,
            target: card.japanese,
            sentence_english: sent.sentence_english,
          },
          answer: { meaning: card.english, reading },
        });
      }
      const ins = await insertSeedItems(pool, items);
      totalInserted += ins.inserted;
      totalSkipped += ins.skipped;
      console.log(`  inserted=${ins.inserted} skipped=${ins.skipped} cost_so_far=$${totalCost.toFixed(4)}`);
    } catch (err) {
      totalFailedBatches += 1;
      console.error(`  batch failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("---");
  console.log(`done. inserted=${totalInserted} skipped=${totalSkipped} failed_batches=${totalFailedBatches} cost=$${totalCost.toFixed(4)}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
