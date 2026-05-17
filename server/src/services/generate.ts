import { randomUUID } from "node:crypto";
import {
  generateVocabBatch,
  generateGrammarBatch,
  generateParticleBatch,
  toRubyHtml,
  readingFor,
  computeCost,
  GenerateError,
  MODEL,
  type Usage,
  type VocabItem,
  type GrammarItem,
  type ParticleItem,
} from "@nihongo/gen";
import { pool } from "../db/pool.js";
import type { ItemRecord, Skill } from "@nihongo/shared";

export type RunResult = {
  generation_id: string;
  status: "success" | "partial";
  items_created: number;
  cost_usd: number;
  items: ItemRecord[];
};

type AnthropicLike = { messages: { create: (body: unknown, opts?: { signal?: AbortSignal }) => Promise<unknown> } };

// Each skill provides (a) a batch generator and (b) an enricher that turns
// the parsed item into the {prompt, answer} jsonb pair stored in `items`.
type Enriched = { prompt: unknown; answer: unknown };

async function genFor(
  skill: Skill,
  args: { count: number; weakness_hint?: string; client?: AnthropicLike; signal?: AbortSignal },
): Promise<{ items: unknown[]; usage: Usage; raw: string }> {
  switch (skill) {
    case "vocab":   return await generateVocabBatch(args);
    case "grammar": return await generateGrammarBatch(args);
    case "particle": return await generateParticleBatch(args);
    default: throw new Error(`generation for skill='${skill}' not implemented yet`);
  }
}

async function enrichFor(skill: Skill, raw: unknown): Promise<Enriched> {
  switch (skill) {
    case "vocab": {
      const it = raw as VocabItem;
      const sentence_ruby = await toRubyHtml(it.sentence_japanese);
      const reading = await readingFor(it.target);
      return {
        prompt: { sentence_ruby, target: it.target, sentence_english: it.sentence_english },
        answer: { meaning: it.sentence_english, reading },
      };
    }
    case "grammar": {
      const it = raw as GrammarItem;
      const sentence_ruby = await toRubyHtml(it.sentence_japanese);
      const another_example_ruby = it.another_example_japanese
        ? await toRubyHtml(it.another_example_japanese)
        : undefined;
      return {
        prompt: { sentence_ruby, pattern: it.pattern, sentence_english: it.sentence_english },
        answer: { explanation: it.explanation, another_example_ruby },
      };
    }
    case "particle": {
      const it = raw as ParticleItem;
      // Run kuromoji over the blanked sentence — keep '___' intact (kuromoji
      // treats it as a single symbol token, which is fine for our render).
      const sentence_ruby_blanked = await toRubyHtml(it.sentence_japanese_blanked);
      return {
        prompt: { sentence_ruby_blanked, options: it.options, answer_index: it.answer_index },
        answer: { explanation: it.explanation },
      };
    }
    default:
      throw new Error(`enrichment for skill='${skill}' not implemented yet`);
  }
}

export async function runGeneration(args: {
  skill: Skill;
  count: number;
  weakness_hint?: string;
  client?: AnthropicLike;
  signal?: AbortSignal;
}): Promise<RunResult> {
  let usage: Usage = { input_tokens: 0, output_tokens: 0 };
  let raw: string | null = null;
  let items: unknown[];
  try {
    const r = await genFor(args.skill, args);
    items = r.items;
    usage = r.usage;
    raw = r.raw;
  } catch (err) {
    const ge = err instanceof GenerateError
      ? err
      : new GenerateError(err instanceof Error ? err.message : String(err), usage, raw);
    await writeFailedRow({
      skill: args.skill,
      count_requested: args.count,
      weakness_hint: args.weakness_hint,
      usage: ge.usage,
      raw: ge.raw,
      error: ge.message,
    });
    throw ge;
  }

  const enriched: Enriched[] = [];
  for (const it of items) {
    enriched.push(await enrichFor(args.skill, it));
  }

  const status: "success" | "partial" = items.length < args.count ? "partial" : "success";
  const cost_usd = computeCost(usage);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted: ItemRecord[] = [];
    for (const e of enriched) {
      const externalId = `ai-${randomUUID()}`;
      const r = await client.query(
        `INSERT INTO items (skill, prompt, answer, source, external_id)
         VALUES ($1, $2, $3, 'ai', $4)
         RETURNING id, skill, prompt, answer, source, external_id, tags, created_at`,
        [args.skill, JSON.stringify(e.prompt), JSON.stringify(e.answer), externalId],
      );
      const row = r.rows[0];
      inserted.push({
        id: row.id, skill: row.skill, prompt: row.prompt, answer: row.answer,
        source: row.source, external_id: row.external_id, tags: row.tags,
        created_at: row.created_at.toISOString(),
      });
    }
    const genRes = await client.query(
      `INSERT INTO generations
        (skill, count_requested, count_inserted, weakness_hint, model,
         prompt, response, input_tokens, output_tokens, cost_usd, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        args.skill, args.count, inserted.length, args.weakness_hint ?? null, MODEL,
        JSON.stringify({ count: args.count, weakness_hint: args.weakness_hint ?? null }),
        raw === null ? null : JSON.stringify({ text: raw }),
        usage.input_tokens, usage.output_tokens, cost_usd, status,
      ],
    );
    await client.query("COMMIT");
    return {
      generation_id: genRes.rows[0].id,
      status, items_created: inserted.length, cost_usd, items: inserted,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    await writeFailedRow({
      skill: args.skill,
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
  skill: Skill;
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
     VALUES ($1, $2, 0, $3, $4, $5, $6, $7, $8, $9, 'failed', $10)`,
    [
      args.skill,
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
