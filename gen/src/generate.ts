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
  buildManualGrammarPrompt,
  buildExplainPrompt,
  buildExplainGradePrompt,
  buildListeningPrompt,
  buildGrammarLessonPrompt,
  buildGrammarSelectionPrompt,
  buildLessonQuizPrompt,
  buildKanjiMnemonicPrompt,
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
  parseManualGrammar,
  parseExplainBatch,
  parseExplainGrade,
  parseListeningBatch,
  parseGrammarLesson,
  parseGrammarSelection,
  parseLessonQuiz,
  parseKanjiMnemonic,
  type VocabItem,
  type SentenceForCard,
  type GrammarItem,
  type ParticleItem,
  type QuizQuestionRaw,
  type ConjugationItem,
  type ReadingItem,
  type ManualVocabItem,
  type ManualGrammarItem,
  type ExplainItem,
  type ExplainGradeRaw,
  type ListeningGenItem,
  type GrammarLesson,
  type GrammarSelection,
  type KanjiMnemonicRaw,
} from "./parse.js";

export type { VocabItem, SentenceForCard, GrammarItem, ParticleItem, ConjugationItem, ReadingItem, ManualVocabItem, ManualGrammarItem, ExplainItem, ExplainGradeRaw, ListeningGenItem, CardInput, Usage, GrammarLesson, GrammarSelection, KanjiMnemonicRaw };

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

const MANUAL_GRAMMAR_FAKE: ManualGrammarItem = {
  pattern: "～てから",
  explanation: "Indicates that one action happens after another is completed: \"after doing X\".",
  sentence_japanese: "ごはんを食べてから、勉強します。",
  sentence_english: "After eating, I will study.",
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

export async function generateManualGrammar(args: {
  input: string;
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ item: ManualGrammarItem; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    return {
      item: MANUAL_GRAMMAR_FAKE,
      usage: { input_tokens: 0, output_tokens: 0 },
      raw: JSON.stringify(MANUAL_GRAMMAR_FAKE),
    };
  }
  const { system, user } = buildManualGrammarPrompt(args.input);
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<ManualGrammarItem>({
    system, user, parse: parseManualGrammar, client, signal: args.signal,
  });
  return { item: value, usage, raw };
}

const LISTENING_FAKE: ListeningGenItem[] = [
  {
    audio_kind: "dialogue", topic: "at the station", jlpt_level: "N4",
    segments: [
      { text: "すみません、東京駅はどこですか。", speaker: 0 },
      { text: "この道をまっすぐ行ってください。", speaker: 1 },
    ],
    transcript_japanese: "すみません、東京駅はどこですか。この道をまっすぐ行ってください。",
    translation_english: "Excuse me, where is Tokyo Station? Go straight down this road.",
    questions: [
      { question_english: "What is the first speaker looking for?", options: ["a bank", "Tokyo Station", "a cafe", "the bathroom"], answer_index: 1, explanation: "They ask 東京駅はどこですか." },
      { question_english: "What direction are they told to go?", options: ["left", "right", "straight", "back"], answer_index: 2, explanation: "まっすぐ = straight." },
    ],
  },
];

export async function generateListeningBatch(args: {
  count: number;
  weakness_hint?: string;
  jlpt_level?: string;
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ items: ListeningGenItem[]; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    const items = LISTENING_FAKE.slice(0, Math.min(args.count, LISTENING_FAKE.length));
    return { items, usage: { input_tokens: 0, output_tokens: 0 }, raw: JSON.stringify({ items }) };
  }
  const { system, user } = buildListeningPrompt({ count: args.count, weakness_hint: args.weakness_hint, jlpt_level: args.jlpt_level });
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<ListeningGenItem[]>({
    system, user, parse: parseListeningBatch, client, signal: args.signal,
  });
  return { items: value, usage, raw };
}

const GRAMMAR_LESSON_FAKE: GrammarLesson = {
  dialog: [
    { speaker: "A", jp: "これを使ってもいいですか。", en: "May I use this?" },
    { speaker: "B", jp: "はい、使ってもいいですよ。", en: "Yes, you may use it." },
  ],
  explanation: "This is a fake grammar explanation used in tests. It covers the point and its nuances.",
};

export async function generateGrammarLesson(args: {
  point: { title: string; meaning: string };
  jlpt_level: string;
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ dialog: { speaker: string; jp: string; en: string }[]; explanation: string; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    return {
      dialog: GRAMMAR_LESSON_FAKE.dialog,
      explanation: GRAMMAR_LESSON_FAKE.explanation,
      usage: { input_tokens: 0, output_tokens: 0 },
      raw: JSON.stringify(GRAMMAR_LESSON_FAKE),
    };
  }
  const { system, user } = buildGrammarLessonPrompt(args);
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<GrammarLesson>({
    system, user, parse: parseGrammarLesson, client, signal: args.signal,
  });
  return { dialog: value.dialog, explanation: value.explanation, usage, raw };
}

function cleanSelectionIds(ids: string[], candidates: { id: string }[]): string[] {
  const validIds = new Set(candidates.map((c) => c.id));
  const cleaned = ids.filter((id) => validIds.has(id)).slice(0, 3);
  if (cleaned.length === 0 && candidates.length > 0) {
    return [candidates[0]!.id];
  }
  return cleaned;
}

export async function generateGrammarSelection(args: {
  theme: string;
  jlpt_level: string;
  candidates: { id: string; title: string; meaning: string }[];
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ ids: string[]; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    const fake: GrammarSelection = { ids: args.candidates.slice(0, 2).map((c) => c.id) };
    const ids = cleanSelectionIds(fake.ids, args.candidates);
    return { ids, usage: { input_tokens: 0, output_tokens: 0 }, raw: JSON.stringify(fake) };
  }
  const { system, user } = buildGrammarSelectionPrompt(args);
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<GrammarSelection>({
    system, user, parse: parseGrammarSelection, client, signal: args.signal,
  });
  const ids = cleanSelectionIds(value.ids, args.candidates);
  return { ids, usage, raw };
}

const LESSON_QUIZ_FAKE: QuizQuestionRaw[] = [
  { question: "Fill in the blank:", sentence_japanese: "これを使っても___。", options: ["いい", "だめ", "ない", "です"], answer_index: 0, explanation: "〜てもいい grants permission." },
  { question: "What does the target grammar mean?", options: ["may / is allowed to", "must not", "want to", "because"], answer_index: 0, explanation: "It expresses permission." },
];

export async function generateLessonQuiz(args: {
  point: { title: string; meaning: string };
  vocab: string[];
  jlpt_level: string;
  count: number;
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ questions: QuizQuestionRaw[]; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    const questions = LESSON_QUIZ_FAKE.slice(0, Math.min(args.count, LESSON_QUIZ_FAKE.length));
    return { questions, usage: { input_tokens: 0, output_tokens: 0 }, raw: JSON.stringify({ questions }) };
  }
  const { system, user } = buildLessonQuizPrompt(args);
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<QuizQuestionRaw[]>({
    system, user, parse: parseLessonQuiz, client, signal: args.signal,
  });
  return { questions: value, usage, raw };
}

const KANJI_MNEMONIC_FAKE: KanjiMnemonicRaw = {
  meaning: {
    gloss: "eat, food",
    scene: "A person ducks under a roof and inhales a whole bowl of rice.",
    hook: "person under a roof + rice -> EAT",
  },
  readings: [
    {
      type: "on",
      reading: "ショク",
      sound_hook: "SHOCK",
      scene: "You take one bite and the flavour is a SHOCK — you eat the whole table.",
      sentence_japanese: "毎日、食事をします。",
      sentence_english: "I have meals every day.",
    },
    {
      type: "kun",
      reading: "た.べる",
      sound_hook: "TA-BELL",
      scene: "A dinner BELL rings and everyone runs to eat.",
      sentence_japanese: "りんごを食べます。",
      sentence_english: "I eat an apple.",
    },
  ],
  recap: ["ショク -> SHOCK, the flavour", "たべる -> TA-BELL rings, time to eat"],
};

export async function generateKanjiMnemonic(args: {
  character: string;
  meanings: string[];
  on: string[];
  kun: string[];
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ mnemonic: KanjiMnemonicRaw; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    return {
      mnemonic: KANJI_MNEMONIC_FAKE,
      usage: { input_tokens: 0, output_tokens: 0 },
      raw: JSON.stringify(KANJI_MNEMONIC_FAKE),
    };
  }
  const { system, user } = buildKanjiMnemonicPrompt({
    character: args.character, meanings: args.meanings, on: args.on, kun: args.kun,
  });
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<KanjiMnemonicRaw>({
    system, user, parse: parseKanjiMnemonic, client, signal: args.signal,
  });
  return { mnemonic: value, usage, raw };
}
