import Anthropic from "@anthropic-ai/sdk";
import { MODEL, type Usage } from "./pricing.js";
import {
  buildVocabPrompt,
  buildSentencesForCardsPrompt,
  type CardInput,
} from "./prompt.js";
import {
  parseVocabBatch,
  parseSentencesForCards,
  type VocabItem,
  type SentenceForCard,
} from "./parse.js";

export type { VocabItem, SentenceForCard, CardInput, Usage };

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

const FAKE_FIXTURE: VocabItem[] = [
  { target: "猫", sentence_japanese: "猫が好きです。", sentence_english: "I like cats." },
  { target: "本", sentence_japanese: "本を読みます。", sentence_english: "I read a book." },
  { target: "水", sentence_japanese: "水を飲みます。", sentence_english: "I drink water." },
  { target: "走る", sentence_japanese: "毎朝走ります。", sentence_english: "I run every morning." },
  { target: "高い", sentence_japanese: "山が高い。", sentence_english: "The mountain is tall." },
];

export async function generateVocabBatch(args: {
  count: number;
  weakness_hint?: string;
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ items: VocabItem[]; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    const items = FAKE_FIXTURE.slice(0, Math.min(args.count, FAKE_FIXTURE.length));
    return { items, usage: { input_tokens: 0, output_tokens: 0 }, raw: JSON.stringify({ items }) };
  }
  const { system, user } = buildVocabPrompt({ count: args.count, weakness_hint: args.weakness_hint });
  const client = args.client ?? new Anthropic();
  const { value, usage, raw } = await callWithRetry<VocabItem[]>({
    system, user, parse: parseVocabBatch, client, signal: args.signal,
  });
  return { items: value, usage, raw };
}

export async function generateSentencesForCards(
  cards: CardInput[],
  opts: { client?: ClientLike } = {},
): Promise<{ sentences: SentenceForCard[]; usage: Usage; raw: string }> {
  const { system, user } = buildSentencesForCardsPrompt(cards);
  const client = opts.client ?? new Anthropic();
  const { value, usage, raw } = await callWithRetry<SentenceForCard[]>({
    system, user, parse: parseSentencesForCards, client,
  });
  return { sentences: value, usage, raw };
}
