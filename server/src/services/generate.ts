import { randomUUID } from "node:crypto";
import {
  generateVocabBatch,
  toRubyHtml,
  readingFor,
  computeCost,
  GenerateError,
  MODEL,
  type Usage,
  type VocabItem,
} from "@nihongo/gen";
import { pool } from "../db/pool.js";
import type { ItemRecord } from "@nihongo/shared";

export type RunResult = {
  generation_id: string;
  status: "success" | "partial";
  items_created: number;
  cost_usd: number;
  items: ItemRecord[];
};

type AnthropicLike = { messages: { create: (body: unknown, opts?: { signal?: AbortSignal }) => Promise<unknown> } };

export async function runVocabGeneration(args: {
  count: number;
  weakness_hint?: string;
  client?: AnthropicLike;
  signal?: AbortSignal;
}): Promise<RunResult> {
  let usage: Usage = { input_tokens: 0, output_tokens: 0 };
  let raw: string | null = null;
  let items: VocabItem[];
  try {
    const r = await generateVocabBatch({
      count: args.count,
      weakness_hint: args.weakness_hint,
      client: args.client,
      signal: args.signal,
    });
    items = r.items;
    usage = r.usage;
    raw = r.raw;
  } catch (err) {
    const ge = err instanceof GenerateError
      ? err
      : new GenerateError(err instanceof Error ? err.message : String(err), usage, raw);
    await writeFailedRow({
      count_requested: args.count,
      weakness_hint: args.weakness_hint,
      usage: ge.usage,
      raw: ge.raw,
      error: ge.message,
    });
    throw ge;
  }

  const enriched: Array<{ prompt: ItemRecord["prompt"]; answer: ItemRecord["answer"] }> = [];
  for (const it of items) {
    const sentence_ruby = await toRubyHtml(it.sentence_japanese);
    const reading = await readingFor(it.target);
    enriched.push({
      prompt: { sentence_ruby, target: it.target, sentence_english: it.sentence_english },
      answer: { meaning: it.sentence_english, reading },
    });
  }

  const status: "success" | "partial" = items.length < args.count ? "partial" : "success";
  const cost_usd = computeCost(usage);
  const promptJson = buildPromptJsonb(args);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted: ItemRecord[] = [];
    for (const e of enriched) {
      const externalId = `ai-${randomUUID()}`;
      const r = await client.query(
        `INSERT INTO items (skill, prompt, answer, source, external_id)
         VALUES ('vocab', $1, $2, 'ai', $3)
         RETURNING id, skill, prompt, answer, source, external_id, tags, created_at`,
        [JSON.stringify(e.prompt), JSON.stringify(e.answer), externalId],
      );
      const row = r.rows[0];
      inserted.push({
        id: row.id,
        skill: row.skill,
        prompt: row.prompt,
        answer: row.answer,
        source: row.source,
        external_id: row.external_id,
        tags: row.tags,
        created_at: row.created_at.toISOString(),
      });
    }
    const genRes = await client.query(
      `INSERT INTO generations
        (skill, count_requested, count_inserted, weakness_hint, model,
         prompt, response, input_tokens, output_tokens, cost_usd, status)
       VALUES ('vocab', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        args.count, inserted.length, args.weakness_hint ?? null, MODEL,
        JSON.stringify(promptJson),
        raw === null ? null : JSON.stringify({ text: raw }),
        usage.input_tokens, usage.output_tokens, cost_usd, status,
      ],
    );
    await client.query("COMMIT");
    return {
      generation_id: genRes.rows[0].id,
      status,
      items_created: inserted.length,
      cost_usd,
      items: inserted,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    await writeFailedRow({
      count_requested: args.count,
      weakness_hint: args.weakness_hint,
      usage, raw,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    client.release();
  }
}

async function writeFailedRow(args: {
  count_requested: number;
  weakness_hint?: string;
  usage: Usage;
  raw: string | null;
  error: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO generations
      (skill, count_requested, count_inserted, weakness_hint, model,
       prompt, response, input_tokens, output_tokens, cost_usd, status, error)
     VALUES ('vocab', $1, 0, $2, $3, $4, $5, $6, $7, $8, 'failed', $9)`,
    [
      args.count_requested,
      args.weakness_hint ?? null,
      MODEL,
      JSON.stringify({ count: args.count_requested, weakness_hint: args.weakness_hint ?? null }),
      args.raw === null ? null : JSON.stringify({ text: args.raw }),
      args.usage.input_tokens,
      args.usage.output_tokens,
      computeCost(args.usage),
      args.error.slice(0, 1000),
    ],
  );
}

function buildPromptJsonb(args: { count: number; weakness_hint?: string }) {
  return {
    count: args.count,
    weakness_hint: args.weakness_hint ?? null,
  };
}
