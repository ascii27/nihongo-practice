import Anthropic from "@anthropic-ai/sdk";
import { MODEL, type Usage } from "./pricing.js";
import {
  buildVocabPrompt,
  buildSentencesForCardsPrompt,
  buildGrammarPrompt,
  buildParticlePrompt,
  type CardInput,
} from "./prompt.js";
import {
  parseVocabBatch,
  parseSentencesForCards,
  parseGrammarBatch,
  parseParticleBatch,
  type VocabItem,
  type SentenceForCard,
  type GrammarItem,
  type ParticleItem,
} from "./parse.js";

export type { VocabItem, SentenceForCard, GrammarItem, ParticleItem, CardInput, Usage };

const MAX_RETRIES = 2; // total attempts = 1 + MAX_RETRIES = 3
const MAX_TOKENS = 2000;

export class GenerateError extends Error {
  constructor(message: string, public usage: Usage, public raw: string | null) {
    super(message);
    this.name = "GenerateError";
  }
}

type ClientLike = { messages: { create: (body: unknown, opts?: { signal?: AbortSignal }) => Promise<unknown> } };

type CallArgs<T> = {
  system: string;
  user: string;
  parse: (raw: string) => T;
  client: ClientLike;
  signal?: AbortSignal;
};

async function callWithRetry<T>(args: CallArgs<T>): Promise<{ value: T; usage: Usage; raw: string }> {
  const usage: Usage = { input_tokens: 0, output_tokens: 0 };
  let lastRaw: string | null = null;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await args.client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: args.system,
        messages: [{ role: "user", content: args.user }],
      }, args.signal ? { signal: args.signal } : undefined) as { content: Array<{ type: string; text?: string }>; usage: Usage };
      usage.input_tokens += resp.usage.input_tokens;
      usage.output_tokens += resp.usage.output_tokens;
      const text = resp.content
        .flatMap((b) => b.type === "text" && b.text ? [b.text] : [])
        .join("");
      lastRaw = text;
      const value = args.parse(text);
      return { value, usage, raw: text };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new GenerateError(
    lastErr instanceof Error ? lastErr.message : "generate failed",
    usage,
    lastRaw,
  );
}

const VOCAB_FAKE: VocabItem[] = [
  { target: "猫", sentence_japanese: "猫が好きです。", sentence_english: "I like cats." },
  { target: "本", sentence_japanese: "本を読みます。", sentence_english: "I read a book." },
  { target: "水", sentence_japanese: "水を飲みます。", sentence_english: "I drink water." },
  { target: "走る", sentence_japanese: "毎朝走ります。", sentence_english: "I run every morning." },
  { target: "高い", sentence_japanese: "山が高い。", sentence_english: "The mountain is tall." },
];

const GRAMMAR_FAKE: GrammarItem[] = [
  { pattern: "〜ながら", sentence_japanese: "音楽を聞きながら勉強します。", sentence_english: "I study while listening to music.", explanation: "〜ながら attaches to the masu-stem and means 'while doing X'." },
  { pattern: "〜たい", sentence_japanese: "寿司を食べたいです。", sentence_english: "I want to eat sushi.", explanation: "〜たい attaches to the masu-stem and expresses desire." },
  { pattern: "〜てから", sentence_japanese: "宿題をしてから寝ます。", sentence_english: "After doing homework I sleep.", explanation: "〜てから expresses 'after doing X'." },
];

const PARTICLE_FAKE: ParticleItem[] = [
  { sentence_japanese_blanked: "学校___行きます。", options: ["は","が","に","を"], answer_index: 2, explanation: "に marks the destination of movement." },
  { sentence_japanese_blanked: "本___読みました。", options: ["は","が","に","を"], answer_index: 3, explanation: "を marks the direct object." },
  { sentence_japanese_blanked: "私___学生です。", options: ["は","が","に","を"], answer_index: 0, explanation: "は marks the topic." },
];

export async function generateVocabBatch(args: {
  count: number;
  weakness_hint?: string;
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ items: VocabItem[]; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    const items = VOCAB_FAKE.slice(0, Math.min(args.count, VOCAB_FAKE.length));
    return { items, usage: { input_tokens: 0, output_tokens: 0 }, raw: JSON.stringify({ items }) };
  }
  const { system, user } = buildVocabPrompt({ count: args.count, weakness_hint: args.weakness_hint });
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<VocabItem[]>({
    system, user, parse: parseVocabBatch, client, signal: args.signal,
  });
  return { items: value, usage, raw };
}

export async function generateGrammarBatch(args: {
  count: number;
  weakness_hint?: string;
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ items: GrammarItem[]; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    const items = GRAMMAR_FAKE.slice(0, Math.min(args.count, GRAMMAR_FAKE.length));
    return { items, usage: { input_tokens: 0, output_tokens: 0 }, raw: JSON.stringify({ items }) };
  }
  const { system, user } = buildGrammarPrompt({ count: args.count, weakness_hint: args.weakness_hint });
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<GrammarItem[]>({
    system, user, parse: parseGrammarBatch, client, signal: args.signal,
  });
  return { items: value, usage, raw };
}

export async function generateParticleBatch(args: {
  count: number;
  weakness_hint?: string;
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ items: ParticleItem[]; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    const items = PARTICLE_FAKE.slice(0, Math.min(args.count, PARTICLE_FAKE.length));
    return { items, usage: { input_tokens: 0, output_tokens: 0 }, raw: JSON.stringify({ items }) };
  }
  const { system, user } = buildParticlePrompt({ count: args.count, weakness_hint: args.weakness_hint });
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<ParticleItem[]>({
    system, user, parse: parseParticleBatch, client, signal: args.signal,
  });
  return { items: value, usage, raw };
}

export async function generateSentencesForCards(
  cards: CardInput[],
  opts: { client?: ClientLike } = {},
): Promise<{ sentences: SentenceForCard[]; usage: Usage; raw: string }> {
  const { system, user } = buildSentencesForCardsPrompt(cards);
  const client = (opts.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<SentenceForCard[]>({
    system, user, parse: parseSentencesForCards, client,
  });
  return { sentences: value, usage, raw };
}
