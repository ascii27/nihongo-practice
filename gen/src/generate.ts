import Anthropic from "@anthropic-ai/sdk";
import { MODEL, type Usage } from "./pricing.js";
import {
  buildVocabPrompt,
  buildSentencesForCardsPrompt,
  buildGrammarPrompt,
  buildParticlePrompt,
  buildConjugationPrompt,
  buildReadingPrompt,
  buildManualVocabPrompt,
  buildExplainPrompt,
  buildExplainGradePrompt,
  type CardInput,
} from "./prompt.js";
import {
  parseVocabBatch,
  parseSentencesForCards,
  parseGrammarBatch,
  parseParticleBatch,
  parseConjugationBatch,
  parseReadingBatch,
  parseManualVocab,
  parseExplainBatch,
  parseExplainGrade,
  type VocabItem,
  type SentenceForCard,
  type GrammarItem,
  type ParticleItem,
  type ConjugationItem,
  type ReadingItem,
  type ManualVocabItem,
  type ExplainItem,
  type ExplainGradeRaw,
} from "./parse.js";

export type { VocabItem, SentenceForCard, GrammarItem, ParticleItem, ConjugationItem, ReadingItem, ManualVocabItem, ExplainItem, ExplainGradeRaw, CardInput, Usage };

const MAX_RETRIES = 2; // total attempts = 1 + MAX_RETRIES = 3
// Raised from 2000: explain items are token-heavy (~450 tok each), so even a
// small sub-batch needs headroom to avoid truncating the JSON mid-response.
// This is only a ceiling — compact skills still bill for what they actually use.
const MAX_TOKENS = 4096;

// explain drills are far more verbose than other skills (a 2–4 sentence model
// answer + rubric notes per item). A single 10-item call takes ~60s and both
// truncates at MAX_TOKENS and overruns the request timeout, so explain requests
// are split into parallel sub-batches of this size (~25s each, run concurrently).
const EXPLAIN_CHUNK = 4;

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

const CONJUGATION_FAKE: ConjugationItem[] = [
  { base: "食べる", tense: "past polite", expected: "食べました", alternates: ["たべました"] },
  { base: "行く", tense: "te-form", expected: "行って", alternates: ["いって"] },
  { base: "見る", tense: "negative polite", expected: "見ません", alternates: ["みません"] },
];

const READING_FAKE: ReadingItem[] = [
  {
    passage_japanese: "山田さんは毎朝六時に起きます。コーヒーを飲んで、新聞を読みます。それから会社へ行きます。",
    question_english: "What does Yamada-san do after drinking coffee?",
    answer_english: "He reads the newspaper.",
    answer_japanese: "新聞を読みます。",
  },
  {
    passage_japanese: "今日は雨が降っています。だから、傘を持って出かけました。学校までは歩いて十分です。",
    question_english: "Why did the speaker take an umbrella?",
    answer_english: "Because it is raining.",
  },
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

export async function generateConjugationBatch(args: {
  count: number;
  weakness_hint?: string;
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ items: ConjugationItem[]; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    const items = CONJUGATION_FAKE.slice(0, Math.min(args.count, CONJUGATION_FAKE.length));
    return { items, usage: { input_tokens: 0, output_tokens: 0 }, raw: JSON.stringify({ items }) };
  }
  const { system, user } = buildConjugationPrompt({ count: args.count, weakness_hint: args.weakness_hint });
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<ConjugationItem[]>({
    system, user, parse: parseConjugationBatch, client, signal: args.signal,
  });
  return { items: value, usage, raw };
}

export async function generateReadingBatch(args: {
  count: number;
  weakness_hint?: string;
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ items: ReadingItem[]; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    const items = READING_FAKE.slice(0, Math.min(args.count, READING_FAKE.length));
    return { items, usage: { input_tokens: 0, output_tokens: 0 }, raw: JSON.stringify({ items }) };
  }
  const { system, user } = buildReadingPrompt({ count: args.count, weakness_hint: args.weakness_hint });
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<ReadingItem[]>({
    system, user, parse: parseReadingBatch, client, signal: args.signal,
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

// Deterministic stub for tests / NIHONGO_FAKE_AI=1. Doesn't try to translate;
// the route tests just need a well-formed item back.
const MANUAL_VOCAB_FAKE: ManualVocabItem = {
  japanese: "テスト",
  english: "test",
  sentence_japanese: "これはテストです。",
  sentence_english: "This is a test.",
};

const EXPLAIN_FAKE: ExplainItem[] = [
  {
    task_english: "Explain to a colleague why your team migrated to TiDB.",
    task_japanese: "同僚に、チームがTiDBへ移行した理由を説明してください。",
    required_connectives: ["つまり", "その結果", "一方で"],
    register: "polite",
    model_explanation_japanese: "結論として、私たちはTiDBへ移行しました。理由はスケーラビリティです。その結果、書き込み性能が向上しました。一方で、運用コストは少し増えました。",
    rubric_notes: "State the conclusion first, give a reason, a concrete result, then a trade-off.",
  },
  {
    task_english: "Explain why last week's incident happened.",
    task_japanese: "先週の障害がなぜ起きたのか説明してください。",
    required_connectives: ["なぜなら", "したがって"],
    register: "formal",
    model_explanation_japanese: "障害はデプロイ時に発生しました。なぜなら、設定の検証が不十分だったからです。したがって、検証手順を追加しました。",
    rubric_notes: "Identify cause, justify with なぜなら, conclude with a したがって follow-up action.",
  },
];

const EXPLAIN_GRADE_FAKE: ExplainGradeRaw = {
  connective_use: 1, structure: 1, register: 1, grammar: 1, overall: 1,
  corrected_japanese: "結論として、移行しました。その結果、性能が向上しました。",
  feedback: "Clear structure and correct connective use.",
};

export async function generateExplainBatch(args: {
  count: number;
  weakness_hint?: string;
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ items: ExplainItem[]; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    const items = EXPLAIN_FAKE.slice(0, Math.min(args.count, EXPLAIN_FAKE.length));
    return { items, usage: { input_tokens: 0, output_tokens: 0 }, raw: JSON.stringify({ items }) };
  }
  const client = (args.client ?? new Anthropic()) as ClientLike;

  // Split into sub-batches of EXPLAIN_CHUNK and run them concurrently. A single
  // 10-item call truncates at MAX_TOKENS and runs ~60s; parallel chunks keep
  // each call small (no truncation, ~25s) and the wall-clock ≈ one chunk.
  const chunks: number[] = [];
  for (let remaining = args.count; remaining > 0; remaining -= EXPLAIN_CHUNK) {
    chunks.push(Math.min(EXPLAIN_CHUNK, remaining));
  }

  const results = await Promise.all(
    chunks.map((n, i) => {
      const { system, user } = buildExplainPrompt({
        count: n,
        weakness_hint: args.weakness_hint,
        variety_note: chunks.length > 1
          ? `This is sub-batch ${i + 1} of ${chunks.length}; choose distinct tasks, connectives, and registers so the overall set stays varied.`
          : undefined,
      });
      return callWithRetry<ExplainItem[]>({ system, user, parse: parseExplainBatch, client, signal: args.signal });
    }),
  );

  const items = results.flatMap((r) => r.value);
  const usage: Usage = {
    input_tokens: results.reduce((sum, r) => sum + r.usage.input_tokens, 0),
    output_tokens: results.reduce((sum, r) => sum + r.usage.output_tokens, 0),
  };
  return { items, usage, raw: JSON.stringify({ items }) };
}

export async function gradeExplanationRaw(args: {
  task_english: string;
  required_connectives: string[];
  register: string;
  answer_given: string;
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ grade: ExplainGradeRaw; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    return {
      grade: EXPLAIN_GRADE_FAKE,
      usage: { input_tokens: 0, output_tokens: 0 },
      raw: JSON.stringify(EXPLAIN_GRADE_FAKE),
    };
  }
  const { system, user } = buildExplainGradePrompt(args);
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<ExplainGradeRaw>({
    system, user, parse: parseExplainGrade, client, signal: args.signal,
  });
  return { grade: value, usage, raw };
}

export async function generateManualVocab(args: {
  input: string;
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ item: ManualVocabItem; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    return {
      item: MANUAL_VOCAB_FAKE,
      usage: { input_tokens: 0, output_tokens: 0 },
      raw: JSON.stringify(MANUAL_VOCAB_FAKE),
    };
  }
  const { system, user } = buildManualVocabPrompt(args.input);
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<ManualVocabItem>({
    system, user, parse: parseManualVocab, client, signal: args.signal,
  });
  return { item: value, usage, raw };
}
