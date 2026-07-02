# Listening Comprehension (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 7th skill, `listening` — an auto-generated audio clip (monologue or dialogue) plus 2–4 multiple-choice comprehension questions — usable in ad-hoc daily practice.

**Architecture:** Claude writes the script + MC questions + transcript + translation (in `gen/`); OpenAI TTS synthesizes an MP3 (in `gen/src/tts.ts`, bytes only); the server enrichment writes the MP3 to `AUDIO_DIR`, sets `audio_url`, and adds furigana to the transcript; the item is stored as an ordinary `items` row. Questions have known answers, so grading is **local on the client** (like `particle`), recorded via the existing `POST /api/reviews`. Audio is served statically off `/audio` (unauthenticated; filenames are random UUIDs).

**Tech Stack:** TypeScript ESM monorepo (npm workspaces, Node ≥ 24), Zod (shared contract), Anthropic SDK, OpenAI `/v1/audio/speech` (`gpt-4o-mini-tts`) via global `fetch`, kuromoji furigana, Express + Postgres (node-pg-migrate), React + Vite, Vitest, Playwright.

## Global Constraints

- **Skill set becomes exactly 7:** `vocab, grammar, reading, conjugation, particle, explain, listening`. Every place that enumerates skills must include `listening`.
- **`shared/src/types.ts` is the source of truth** — client and server both consume its Zod schemas; add new shapes there first.
- **Content primitive unchanged:** a listening item is a normal `items` row (`skill='listening'`, `prompt` jsonb, `answer` jsonb, `source='ai'`). No new content table.
- **Grade locally, no LLM at grade time:** overall `got_it` when fraction of questions correct ≥ **0.6** (mirrors `explain`). Uses existing `POST /api/reviews`; no new grade endpoint.
- **AI calls must honor `NIHONGO_FAKE_AI=1`** — every generator/TTS path returns deterministic fakes with zero cost when set, matching the existing `gen/` pattern (tests/CI run with it).
- **Cost tracked in USD** — TTS character cost is added on top of the Anthropic token cost in the same `generations.cost_usd`.
- **ESM import paths use `.js` extensions** in TS source (e.g. `import { x } from "./tts.js"`), per the existing codebase.
- **Furigana HTML is sanitized** by the existing pipeline; the transcript runs through `toRubyHtml` exactly like other Japanese fields.

---

### Task 1: Shared types — `listening` skill + prompt/answer + 7-skill `by_skill`

**Files:**
- Modify: `shared/src/types.ts` (Skill enum ~line 27; `DashboardResponse.by_skill` ~263; `StatsBySkillResponse.by_skill` ~283; `LibraryResponse.by_skill` ~316; add new Listening shapes after the `ExplainGrade*` block)
- Test: `shared/src/types.test.ts` (create if absent; otherwise append)

**Interfaces:**
- Produces: `Skill` now includes `"listening"`. `ListeningQuestion = { question_english: string; options: [string,string,string,string]; answer_index: 0|1|2|3 }`. `ListeningPrompt = { audio_url: string; audio_kind: "monologue"|"dialogue"; topic: string; jlpt_level: string; questions: ListeningQuestion[] }` (1–4 questions). `ListeningAnswer = { transcript_ruby: string; translation_english: string; question_explanations?: string[] }`. All three `by_skill` objects gain a `listening` key of the same per-skill shape as the others.

- [ ] **Step 1: Write the failing test**

```ts
// shared/src/types.test.ts
import { describe, it, expect } from "vitest";
import { Skill, ListeningPrompt, ListeningAnswer, DashboardResponse } from "./types.js";

describe("listening types", () => {
  it("accepts listening as a Skill", () => {
    expect(Skill.parse("listening")).toBe("listening");
  });

  it("parses a valid ListeningPrompt", () => {
    const p = {
      audio_url: "/audio/abc.mp3",
      audio_kind: "dialogue",
      topic: "at the station",
      jlpt_level: "N4",
      questions: [
        { question_english: "Where are they?", options: ["a", "b", "c", "d"], answer_index: 1 },
      ],
    };
    expect(ListeningPrompt.parse(p)).toEqual(p);
  });

  it("rejects a question without exactly 4 options", () => {
    const bad = {
      audio_url: "/audio/abc.mp3", audio_kind: "monologue", topic: "t", jlpt_level: "N5",
      questions: [{ question_english: "q", options: ["a", "b"], answer_index: 0 }],
    };
    expect(ListeningPrompt.safeParse(bad).success).toBe(false);
  });

  it("parses a ListeningAnswer", () => {
    const a = { transcript_ruby: "<ruby>駅<rt>えき</rt></ruby>です", translation_english: "It's a station." };
    expect(ListeningAnswer.parse(a)).toEqual(a);
  });

  it("DashboardResponse.by_skill requires a listening bucket", () => {
    const base = { due: 0, new: 0 };
    const without = {
      streak_days: 0, last_practiced_at: null,
      by_skill: { vocab: base, grammar: base, reading: base, conjugation: base, particle: base, explain: base },
    };
    expect(DashboardResponse.safeParse(without).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w shared -- types.test`
Expected: FAIL — `ListeningPrompt` is not exported / `listening` not in enum.

- [ ] **Step 3: Add the types**

In `shared/src/types.ts`, change the Skill enum:

```ts
export const Skill = z.enum(["vocab", "grammar", "reading", "conjugation", "particle", "explain", "listening"]);
```

Add after the `ExplainGradeResponse` block:

```ts
// ----- Listening item -----

export const ListeningQuestion = z.object({
  question_english: z.string(),
  options: z.array(z.string()).length(4),
  answer_index: z.number().int().min(0).max(3),
});
export type ListeningQuestion = z.infer<typeof ListeningQuestion>;

export const ListeningPrompt = z.object({
  audio_url: z.string(),                       // e.g. "/audio/<uuid>.mp3"
  audio_kind: z.enum(["monologue", "dialogue"]),
  topic: z.string(),
  jlpt_level: z.string(),                       // "N5".."N1"
  questions: z.array(ListeningQuestion).min(1).max(4),
});
export type ListeningPrompt = z.infer<typeof ListeningPrompt>;

export const ListeningAnswer = z.object({
  transcript_ruby: z.string(),                  // furigana HTML, revealed after answering
  translation_english: z.string(),
  question_explanations: z.array(z.string()).optional(),
});
export type ListeningAnswer = z.infer<typeof ListeningAnswer>;
```

Add `listening: SkillCounts,` to the `DashboardResponse.by_skill` object; add `listening: SkillStats,` to `StatsBySkillResponse.by_skill`; add `listening: LibrarySkillGroup,` to `LibraryResponse.by_skill`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w shared -- types.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/types.ts shared/src/types.test.ts
git commit -m "feat(shared): add listening skill + prompt/answer types"
```

---

### Task 2: Migration — widen `items.skill` CHECK to 7 skills

**Files:**
- Create: `db/migrations/1783036800000_items_skill_listening.sql`

**Interfaces:**
- Produces: `items` rows with `skill='listening'` are insertable. No code depends on this task's output beyond the DB accepting the value.

- [ ] **Step 1: Write the migration** (mirrors `1780358400000_items_skill_explain.sql`)

```sql
-- 1783036800000_items_skill_listening.sql
-- Phase: add the `listening` skill. Widen the items.skill CHECK so the seventh
-- skill can be stored. Constraint name is items_skill_check (see prior migration).
ALTER TABLE items DROP CONSTRAINT items_skill_check;
ALTER TABLE items ADD CONSTRAINT items_skill_check
  CHECK (skill IN ('vocab','grammar','reading','conjugation','particle','explain','listening'));
```

- [ ] **Step 2: Apply and verify**

Run: `npm run db:up && npm run db:migrate`
Then verify the constraint accepts the new value:
Run: `psql "$DATABASE_URL" -c "INSERT INTO items (skill, prompt, answer, source) VALUES ('listening','{}','{}','ai') RETURNING id;"`
Expected: one row returned (a UUID). Clean up:
Run: `psql "$DATABASE_URL" -c "DELETE FROM items WHERE skill='listening';"`

- [ ] **Step 3: Commit**

```bash
git add db/migrations/1783036800000_items_skill_listening.sql
git commit -m "feat(db): allow listening in items.skill check"
```

---

### Task 3: TTS client + pricing (`gen/src/tts.ts`)

**Files:**
- Create: `gen/src/tts.ts`
- Create: `gen/src/tts.test.ts`
- Modify: `gen/src/pricing.ts` (add TTS pricing + `computeTtsCost`)
- Modify: `gen/src/index.ts` (export `synthesizeSpeech`, `computeTtsCost`, `TTS_MODEL`, types)

**Interfaces:**
- Consumes: `TTS_USD_PER_1K_CHARS`, `computeTtsCost(chars: number): number` from `pricing.ts`.
- Produces: `type Segment = { text: string; speaker: 0 | 1 }`; `synthesizeSpeech(segments: Segment[], opts?: { fetchImpl?: typeof fetch }): Promise<{ audio: Uint8Array; chars: number; cost_usd: number }>`. Dialogue alternates two voices by `speaker`; monologue passes a single segment with `speaker: 0`. No filesystem I/O here — returns bytes only. No-op-safe: when `NIHONGO_FAKE_AI=1` or `OPENAI_API_KEY` is unset, returns a small deterministic placeholder MP3 buffer with `cost_usd: 0`.

- [ ] **Step 1: Add pricing constants + helper**

In `gen/src/pricing.ts` append:

```ts
// OpenAI gpt-4o-mini-tts. Char-based estimate (verify against live billing and
// tune). ~$15 / 1M characters ⇒ $0.015 / 1k chars.
export const TTS_MODEL = "gpt-4o-mini-tts";
export const TTS_USD_PER_1K_CHARS = 0.015;

export function computeTtsCost(chars: number): number {
  return (chars / 1000) * TTS_USD_PER_1K_CHARS;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// gen/src/tts.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { synthesizeSpeech } from "./tts.js";

const OLD = process.env.NIHONGO_FAKE_AI;
afterEach(() => { process.env.NIHONGO_FAKE_AI = OLD; });

describe("synthesizeSpeech", () => {
  it("returns a placeholder buffer with zero cost in fake mode", async () => {
    process.env.NIHONGO_FAKE_AI = "1";
    const r = await synthesizeSpeech([{ text: "こんにちは", speaker: 0 }]);
    expect(r.audio.byteLength).toBeGreaterThan(0);
    expect(r.cost_usd).toBe(0);
  });

  it("calls one request per segment and sums characters (real mode)", async () => {
    process.env.NIHONGO_FAKE_AI = "0";
    process.env.OPENAI_API_KEY = "sk-test";
    const calls: unknown[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(init.body as string));
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response;
    }) as unknown as typeof fetch;
    const r = await synthesizeSpeech(
      [{ text: "ああ", speaker: 0 }, { text: "いい", speaker: 1 }],
      { fetchImpl: fakeFetch },
    );
    expect(calls.length).toBe(2);
    expect(r.chars).toBe(4);
    expect(r.cost_usd).toBeGreaterThan(0);
    expect(r.audio.byteLength).toBe(6); // two 3-byte chunks concatenated
  });

  it("throws when the API returns a non-ok response", async () => {
    process.env.NIHONGO_FAKE_AI = "0";
    process.env.OPENAI_API_KEY = "sk-test";
    const fakeFetch = (async () => ({ ok: false, status: 500, text: async () => "boom" } as Response)) as unknown as typeof fetch;
    await expect(
      synthesizeSpeech([{ text: "x", speaker: 0 }], { fetchImpl: fakeFetch }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w gen -- tts.test`
Expected: FAIL — `./tts.js` not found.

- [ ] **Step 4: Implement `gen/src/tts.ts`**

```ts
import { TTS_MODEL, computeTtsCost } from "./pricing.js";

export type Segment = { text: string; speaker: 0 | 1 };

// Two distinct OpenAI voices so dialogue speakers are audibly different.
const VOICES = ["alloy", "onyx"] as const;

// Minimal non-empty placeholder returned in fake mode / when unconfigured.
// Not a valid tune — playback is not asserted in tests/e2e.
const PLACEHOLDER = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

export async function synthesizeSpeech(
  segments: Segment[],
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ audio: Uint8Array; chars: number; cost_usd: number }> {
  const chars = segments.reduce((n, s) => n + s.text.length, 0);
  const key = process.env.OPENAI_API_KEY;
  if (process.env.NIHONGO_FAKE_AI === "1" || !key) {
    return { audio: PLACEHOLDER, chars, cost_usd: 0 };
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const chunks: Uint8Array[] = [];
  for (const seg of segments) {
    const res = await doFetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: VOICES[seg.speaker] ?? VOICES[0],
        input: seg.text,
        response_format: "mp3",
      }),
    });
    if (!res.ok) {
      const detail = typeof res.text === "function" ? await res.text() : "";
      throw new Error(`TTS request failed: ${res.status} ${detail}`);
    }
    chunks.push(new Uint8Array(await res.arrayBuffer()));
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const audio = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { audio.set(c, off); off += c.byteLength; }
  return { audio, chars, cost_usd: computeTtsCost(chars) };
}
```

- [ ] **Step 5: Export from `gen/src/index.ts`**

Add:

```ts
export { computeTtsCost, TTS_MODEL, TTS_USD_PER_1K_CHARS } from "./pricing.js";
export { synthesizeSpeech, type Segment } from "./tts.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -w gen -- tts.test`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add gen/src/tts.ts gen/src/tts.test.ts gen/src/pricing.ts gen/src/index.ts
git commit -m "feat(gen): OpenAI TTS client + char-based cost"
```

---

### Task 4: Listening generation — prompt, parse, batch (`gen/`)

**Files:**
- Modify: `gen/src/prompt.ts` (add `buildListeningPrompt`)
- Modify: `gen/src/parse.ts` (add `ListeningGenItem` + `parseListeningBatch`)
- Modify: `gen/src/generate.ts` (add `LISTENING_FAKE` + `generateListeningBatch`)
- Modify: `gen/src/index.ts` (export the three)
- Test: `gen/src/parse.test.ts` (append), `gen/src/generate.test.ts` (append)

**Interfaces:**
- Consumes: `callWithRetry`, `ClientLike` (already in `generate.ts`).
- Produces: `type ListeningGenItem = { audio_kind: "monologue"|"dialogue"; topic: string; jlpt_level: string; segments: { text: string; speaker: 0|1 }[]; transcript_japanese: string; translation_english: string; questions: { question_english: string; options: [string,string,string,string]; answer_index: number; explanation?: string }[] }`. `parseListeningBatch(raw: string): ListeningGenItem[]`. `generateListeningBatch(args: { count; weakness_hint?; jlpt_level?; client?; signal? }): Promise<{ items: ListeningGenItem[]; usage; raw }>`. `buildListeningPrompt(args: { count; weakness_hint?; jlpt_level?: string }): PromptPair`.

- [ ] **Step 1: Write the failing parse test**

```ts
// append to gen/src/parse.test.ts
import { parseListeningBatch } from "./parse.js";

describe("parseListeningBatch", () => {
  const one = {
    audio_kind: "dialogue", topic: "at a cafe", jlpt_level: "N4",
    segments: [{ text: "いらっしゃいませ。", speaker: 0 }, { text: "コーヒーをください。", speaker: 1 }],
    transcript_japanese: "いらっしゃいませ。コーヒーをください。",
    translation_english: "Welcome. A coffee please.",
    questions: [{ question_english: "What did the customer order?", options: ["tea", "coffee", "water", "juice"], answer_index: 1, explanation: "They said コーヒー." }],
  };

  it("parses a valid batch", () => {
    expect(parseListeningBatch(JSON.stringify({ items: [one] }))).toHaveLength(1);
  });

  it("rejects a question without 4 options", () => {
    const bad = { ...one, questions: [{ ...one.questions[0], options: ["a", "b"] }] };
    expect(() => parseListeningBatch(JSON.stringify({ items: [bad] }))).toThrow();
  });

  it("rejects a segment with an out-of-range speaker", () => {
    const bad = { ...one, segments: [{ text: "x", speaker: 2 }] };
    expect(() => parseListeningBatch(JSON.stringify({ items: [bad] }))).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w gen -- parse.test`
Expected: FAIL — `parseListeningBatch` not exported.

- [ ] **Step 3: Add the parser** (`gen/src/parse.ts`)

```ts
export type ListeningGenItem = {
  audio_kind: "monologue" | "dialogue";
  topic: string;
  jlpt_level: string;
  segments: { text: string; speaker: 0 | 1 }[];
  transcript_japanese: string;
  translation_english: string;
  questions: { question_english: string; options: string[]; answer_index: number; explanation?: string }[];
};

export function parseListeningBatch(raw: string): ListeningGenItem[] {
  const parsed = JSON.parse(stripFences(raw));
  const items = parsed?.items;
  if (!Array.isArray(items)) throw new Error("response missing 'items' array");
  for (const it of items) {
    if (
      (it?.audio_kind !== "monologue" && it?.audio_kind !== "dialogue") ||
      typeof it?.topic !== "string" ||
      typeof it?.jlpt_level !== "string" ||
      typeof it?.transcript_japanese !== "string" ||
      typeof it?.translation_english !== "string" ||
      !Array.isArray(it?.segments) || it.segments.length === 0 ||
      !Array.isArray(it?.questions) || it.questions.length < 1 || it.questions.length > 4
    ) {
      throw new Error("listening item missing or invalid required fields");
    }
    for (const s of it.segments) {
      if (typeof s?.text !== "string" || (s?.speaker !== 0 && s?.speaker !== 1)) {
        throw new Error("listening item has invalid segment");
      }
    }
    for (const q of it.questions) {
      if (
        typeof q?.question_english !== "string" ||
        !Array.isArray(q?.options) || q.options.length !== 4 ||
        q.options.some((o: unknown) => typeof o !== "string") ||
        typeof q?.answer_index !== "number" || !Number.isInteger(q.answer_index) ||
        q.answer_index < 0 || q.answer_index > 3
      ) {
        throw new Error("listening item has invalid question");
      }
    }
  }
  return items as ListeningGenItem[];
}
```

- [ ] **Step 4: Add the prompt** (`gen/src/prompt.ts`)

```ts
const LISTENING_SYSTEM = `You generate Japanese listening-comprehension items for a learner at the given JLPT level. Each item is either a short monologue (~3–5 sentences) or a two-person dialogue (~4–8 turns) on one everyday or workplace topic, plus 2–4 English multiple-choice comprehension questions.
Rules:
- Keep vocabulary and grammar appropriate to the JLPT level.
- "segments" breaks the script into speech turns: speaker 0 and (for dialogue) speaker 1, in spoken order. For a monologue use a single speaker 0 segment or several speaker-0 segments.
- "transcript_japanese" is the full script as plain Japanese text (concatenate the segment texts).
- Each question has exactly four options and one correct answer_index (0–3). Vary the correct position across questions. Questions must require comprehension, not just word-spotting.
Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "items": [ { "audio_kind": "monologue|dialogue", "topic": "<short EN>", "jlpt_level": "<N5..N1>", "segments": [ { "text": "<JA>", "speaker": 0 } ], "transcript_japanese": "<JA>", "translation_english": "<EN>", "questions": [ { "question_english": "<EN>", "options": ["<a>","<b>","<c>","<d>"], "answer_index": 0, "explanation": "<1 sentence EN>" } ] } ] }`;

export function buildListeningPrompt(args: { count: number; weakness_hint?: string; jlpt_level?: string }): PromptPair {
  const lines: string[] = [`Generate ${args.count} listening-comprehension items at JLPT level ${args.jlpt_level ?? "N4"}.`];
  if (args.weakness_hint && args.weakness_hint.trim().length > 0) {
    lines.push(`Focus on: ${args.weakness_hint.trim()}`);
  }
  lines.push("Mix monologue and dialogue across the batch, and vary topics.");
  return { system: LISTENING_SYSTEM, user: lines.join("\n") };
}
```

- [ ] **Step 5: Add the batch generator + fake** (`gen/src/generate.ts`)

Add the import of `buildListeningPrompt` (to the `./prompt.js` import block), `parseListeningBatch` and `type ListeningGenItem` (to the `./parse.js` import block), re-export `ListeningGenItem` in the `export type { ... }` line, then add:

```ts
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
```

- [ ] **Step 6: Write the failing generate test**

```ts
// append to gen/src/generate.test.ts
import { generateListeningBatch } from "./generate.js";

describe("generateListeningBatch (fake mode)", () => {
  it("returns a well-formed listening item with zero cost", async () => {
    process.env.NIHONGO_FAKE_AI = "1";
    const r = await generateListeningBatch({ count: 1 });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].questions.length).toBeGreaterThanOrEqual(2);
    expect(r.usage.output_tokens).toBe(0);
  });
});
```

- [ ] **Step 7: Export from `gen/src/index.ts`**

Add `buildListeningPrompt` to the prompt export line, `parseListeningBatch, type ListeningGenItem` to the parse export line, and `generateListeningBatch` to the generate export block.

- [ ] **Step 8: Run tests**

Run: `npm test -w gen -- parse.test generate.test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add gen/src/prompt.ts gen/src/parse.ts gen/src/generate.ts gen/src/index.ts gen/src/parse.test.ts gen/src/generate.test.ts
git commit -m "feat(gen): listening prompt, parser, and batch generator"
```

---

### Task 5: Server env + audio writing + enrichment + generation wiring

**Files:**
- Modify: `server/src/env.ts` (add optional `OPENAI_API_KEY`, `AUDIO_DIR`)
- Create: `server/src/services/audio-store.ts` (write bytes → file, return url)
- Create: `server/src/services/audio-store.test.ts`
- Modify: `server/src/services/generate.ts` (`genFor` + `enrichFor` listening; thread audio cost)
- Test: `server/src/services/generate.test.ts` (append a listening case)
- Modify: `.env.example` (document the two new vars)

**Interfaces:**
- Consumes: `synthesizeSpeech`, `type Segment`, `toRubyHtml` from `@nihongo/gen`; `env.AUDIO_DIR`.
- Produces: `saveAudio(bytes: Uint8Array): Promise<{ audio_url: string }>` — writes `<uuid>.mp3` under `AUDIO_DIR`, returns `{ audio_url: "/audio/<uuid>.mp3" }`. `enrichFor` for `listening` returns `{ prompt, answer, audio_cost_usd }`; `Enriched` gains optional `audio_cost_usd?: number`; `runGeneration` adds the summed `audio_cost_usd` to `cost_usd`.

- [ ] **Step 1: Add env vars** (`server/src/env.ts`)

```ts
const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  PASSCODE: z.string().min(1, "PASSCODE is required"),
  DATABASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string().optional(),
  AUDIO_DIR: z.string().default("./data/audio"),
});
```

Add to `.env.example`:

```
# Optional: OpenAI key for listening TTS (unset ⇒ listening audio is a silent placeholder)
OPENAI_API_KEY=
# Where generated listening MP3s are written (served at /audio)
AUDIO_DIR=./data/audio
```

- [ ] **Step 2: Write the failing audio-store test**

```ts
// server/src/services/audio-store.test.ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { saveAudio } from "./audio-store.js";

describe("saveAudio", () => {
  it("writes an mp3 and returns a /audio url", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { audio_url } = await saveAudio(bytes);
    expect(audio_url).toMatch(/^\/audio\/[0-9a-f-]+\.mp3$/);
    const file = audio_url.replace("/audio/", "");
    const dir = process.env.AUDIO_DIR ?? "./data/audio";
    const written = await readFile(`${dir}/${file}`);
    expect(written.byteLength).toBe(4);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -w server -- audio-store.test`
Expected: FAIL — `./audio-store.js` not found.

- [ ] **Step 4: Implement `server/src/services/audio-store.ts`**

```ts
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { env } from "../env.js";

// Writes raw MP3 bytes to AUDIO_DIR/<uuid>.mp3 and returns the public URL.
// The filename is a random UUID (unguessable) so /audio can be served
// unauthenticated — an <audio> element cannot send the passcode header.
export async function saveAudio(bytes: Uint8Array): Promise<{ audio_url: string }> {
  await mkdir(env.AUDIO_DIR, { recursive: true });
  const name = `${randomUUID()}.mp3`;
  await writeFile(`${env.AUDIO_DIR}/${name}`, bytes);
  return { audio_url: `/audio/${name}` };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -w server -- audio-store.test`
Expected: PASS.

- [ ] **Step 6: Wire listening into `generate.ts`**

Extend the `@nihongo/gen` import with `generateListeningBatch, synthesizeSpeech, type ListeningGenItem`. Change the `Enriched` type and both switches:

```ts
type Enriched = { prompt: unknown; answer: unknown; audio_cost_usd?: number };
```

In `genFor`, add:

```ts
    case "listening": return await generateListeningBatch(args);
```

In `enrichFor`, add before `default:`:

```ts
    case "listening": {
      const it = raw as ListeningGenItem;
      const { audio, cost_usd } = await synthesizeSpeech(it.segments);
      const { audio_url } = await saveAudio(audio);
      const transcript_ruby = await toRubyHtml(it.transcript_japanese);
      return {
        prompt: {
          audio_url,
          audio_kind: it.audio_kind,
          topic: it.topic,
          jlpt_level: it.jlpt_level,
          questions: it.questions.map((q) => ({
            question_english: q.question_english,
            options: q.options,
            answer_index: q.answer_index,
          })),
        },
        answer: {
          transcript_ruby,
          translation_english: it.translation_english,
          question_explanations: it.questions.map((q) => q.explanation ?? ""),
        },
        audio_cost_usd: cost_usd,
      };
    }
```

Add `import { saveAudio } from "./audio-store.js";` at the top. In `runGeneration`, after building `enriched`, change the cost line:

```ts
  const audioCost = enriched.reduce((sum, e) => sum + (e.audio_cost_usd ?? 0), 0);
  const cost_usd = computeCost(usage) + audioCost;
```

- [ ] **Step 7: Write the failing generate-service test**

```ts
// append to server/src/services/generate.test.ts
describe("runGeneration listening (fake mode)", () => {
  it("inserts a listening item with an audio_url and questions", async () => {
    process.env.NIHONGO_FAKE_AI = "1";
    const r = await runGeneration({ skill: "listening", count: 1 });
    expect(r.items_created).toBe(1);
    const prompt = r.items[0].prompt as { audio_url: string; questions: unknown[] };
    expect(prompt.audio_url).toMatch(/^\/audio\/.+\.mp3$/);
    expect(prompt.questions.length).toBeGreaterThanOrEqual(2);
  });
});
```

(Follow the existing setup/teardown in this test file — reuse its DB reset/`beforeEach` helpers; do not invent a new harness.)

- [ ] **Step 8: Run tests**

Run: `npm test -w server -- generate.test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/env.ts server/src/services/audio-store.ts server/src/services/audio-store.test.ts server/src/services/generate.ts server/src/services/generate.test.ts .env.example
git commit -m "feat(server): synthesize+store listening audio, enrich, add TTS cost"
```

---

### Task 6: Serve `/audio` statically (dev + prod)

**Files:**
- Modify: `server/src/index.ts` (static mount, before the passcode middleware)
- Modify: `client/vite.config.ts` (proxy `/audio` in dev)

**Interfaces:**
- Produces: `GET /audio/<file>.mp3` returns the stored bytes, unauthenticated, in both dev (vite proxy → server) and prod (express static; nginx documented).

- [ ] **Step 1: Mount static audio** — in `server/src/index.ts`, after `app.get("/healthz", ...)` and BEFORE `app.use("/api", passcodeMiddleware(...))`:

```ts
  app.use("/audio", express.static(env.AUDIO_DIR));
```

(`env` is already imported.)

- [ ] **Step 2: Proxy `/audio` in dev** — in `client/vite.config.ts`:

```ts
    proxy: {
      "/api": "http://localhost:3001",
      "/audio": "http://localhost:3001",
    },
```

- [ ] **Step 3: Verify** — with the server running (`npm run dev:e2e`), generate a listening item (Task 8 UI, or `curl -XPOST localhost:3001/api/generate -H "X-Passcode: $PASSCODE" -H 'content-type: application/json' -d '{"skill":"listening","count":1}'`), then:
Run: `curl -sI "http://localhost:3001$AUDIO_URL"` (using the `audio_url` from the response)
Expected: `HTTP/1.1 200 OK`, `Content-Type: audio/mpeg`.

- [ ] **Step 4: Document nginx** — append to `README.md` (Configuration section) a prod note:

```
Listening audio is written to AUDIO_DIR and served at /audio. In production, let
nginx serve it directly:

    location /audio/ { alias /path/to/AUDIO_DIR/; }
```

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts client/vite.config.ts README.md
git commit -m "feat(server): serve /audio static; proxy in dev; document nginx"
```

---

### Task 7: Server skill enumerations → include `listening`

**Files:**
- Modify: `server/src/routes/dashboard.ts:5`, `server/src/routes/stats.ts:8`, `server/src/routes/library.ts:7` (the `SKILLS` const arrays), `server/src/routes/queue.ts:6` (`SUPPORTED_SKILLS` set)
- Modify: `server/src/services/item-display.ts` (add `listening` case)
- Test: `server/src/services/item-display.test.ts` (append), `server/src/routes/dashboard.test.ts` (assert 7th bucket)

**Interfaces:**
- Consumes: `ListeningPrompt`/`ListeningAnswer` shapes from Task 1.
- Produces: dashboard/stats/library responses contain a `listening` bucket; queue skill-filter accepts `listening`; `itemDisplay("listening", …)` returns a summary row.

- [ ] **Step 1: Write the failing item-display test**

```ts
// append to server/src/services/item-display.test.ts
import { itemDisplay } from "./item-display.js";

describe("itemDisplay listening", () => {
  it("summarizes a listening item by topic + kind", () => {
    const d = itemDisplay(
      "listening",
      { audio_url: "/audio/x.mp3", audio_kind: "dialogue", topic: "at the station", jlpt_level: "N4", questions: [{ question_english: "q", options: ["a","b","c","d"], answer_index: 0 }] },
      { transcript_ruby: "<ruby>駅<rt>えき</rt></ruby>", translation_english: "station" },
    );
    expect(d.front).toContain("at the station");
    expect(d.meaning.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- item-display.test`
Expected: FAIL — listening returns the empty default `{ front: "", … }`.

- [ ] **Step 3: Add the `listening` case** in `item-display.ts` before `default:`

```ts
    case "listening": {
      const kind = str(p.audio_kind) || "clip";
      const n = Array.isArray(p.questions) ? p.questions.length : 0;
      return {
        front: `${kind}: ${str(p.topic)}`,
        reading: str(p.jlpt_level) || null,
        meaning: `${n} question${n === 1 ? "" : "s"}`,
      };
    }
```

- [ ] **Step 4: Update the four skill enumerations** — set each to the full 7 in the same order as the client `SKILL_ORDER` where the array is display-facing, appending `"listening"`:

```ts
// dashboard.ts:5, stats.ts:8, library.ts:7
const SKILLS = ["vocab", "grammar", "reading", "conjugation", "particle", "explain", "listening"] as const;
```

```ts
// queue.ts:6
const SUPPORTED_SKILLS = new Set(["vocab", "grammar", "particle", "conjugation", "reading", "explain", "listening"]);
```

- [ ] **Step 5: Assert the dashboard 7th bucket** — append to `server/src/routes/dashboard.test.ts` an assertion that the response `by_skill` has a `listening` key (follow the file's existing request helper):

```ts
it("includes a listening bucket", async () => {
  const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
  expect(res.body.by_skill).toHaveProperty("listening");
});
```

(Reuse the file's existing `app`/`PASSCODE`/`request` setup — do not create a new one.)

- [ ] **Step 6: Run tests**

Run: `npm test -w server -- item-display.test dashboard.test stats.test library.test queue.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/dashboard.ts server/src/routes/stats.ts server/src/routes/library.ts server/src/routes/queue.ts server/src/services/item-display.ts server/src/services/item-display.test.ts server/src/routes/dashboard.test.ts
git commit -m "feat(server): include listening across dashboard/stats/library/queue"
```

---

### Task 8: Client skill metadata → include `listening`

**Files:**
- Modify: `client/src/lib/skills.ts` (`SKILL_ORDER`, `SKILL_META`)
- Modify: `client/src/components/GenerateForm.tsx` (`SKILL_LABELS`)

**Interfaces:**
- Produces: `listening` appears in the generate-form skill picker, Dashboard/Browse/Stats skill lists, and card chips. `SKILL_ORDER` includes `"listening"`; `SKILL_META.listening` and `SKILL_LABELS.listening` exist. **These three maps are keyed by `Skill`, so TypeScript will fail to compile until each has a `listening` entry — that is the safety net for this task.**

- [ ] **Step 1: Update `skills.ts`**

```ts
export const SKILL_ORDER: Skill[] = ["vocab", "grammar", "particle", "conjugation", "reading", "explain", "listening"];

export const SKILL_META: Record<Skill, { label: string; ja: string; short: string }> = {
  vocab: { label: "Vocab", ja: "語彙", short: "語" },
  grammar: { label: "Grammar", ja: "文法", short: "文" },
  particle: { label: "Particles", ja: "助詞", short: "助" },
  conjugation: { label: "Conjugation", ja: "活用", short: "活" },
  reading: { label: "Reading", ja: "読解", short: "読" },
  explain: { label: "Explain", ja: "説明", short: "説" },
  listening: { label: "Listening", ja: "聴解", short: "聴" },
};
```

- [ ] **Step 2: Update `GenerateForm.tsx` `SKILL_LABELS`** — add `listening: "Listening",`.

- [ ] **Step 3: Typecheck**

Run: `npm run build -w client` (or `tsc -p client --noEmit` if configured)
Expected: compiles with no "property 'listening' is missing" errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/skills.ts client/src/components/GenerateForm.tsx
git commit -m "feat(client): register listening skill metadata + generate label"
```

---

### Task 9: `ListeningCard` component + practice dispatch + local grading

**Files:**
- Create: `client/src/components/ListeningCard.tsx`
- Create: `client/src/components/ListeningCard.test.tsx`
- Modify: `client/src/screens/PracticeScreen.tsx` (dispatch `listening` → `ListeningCard`)

**Interfaces:**
- Consumes: `ItemRecord`, `ListeningPrompt`, `ListeningAnswer`, `ReviewResult` from `@nihongo/shared`; `RubyText`, `SwipeDeck`; the API base for the audio `src` = `import.meta.env.VITE_API_BASE ?? ""` prefixed to `prompt.audio_url`.
- Produces: `ListeningCard({ item, onAnswer }: { item: ItemRecord; onAnswer: (r: ReviewResult) => void })`. Plays audio, presents each MC question, computes fraction correct, calls `onAnswer(fraction >= 0.6 ? "got_it" : "missed")`, then reveals transcript + translation.

- [ ] **Step 1: Write the failing component test**

```tsx
// client/src/components/ListeningCard.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ListeningCard } from "./ListeningCard";
import type { ItemRecord } from "@nihongo/shared";

const item: ItemRecord = {
  id: "11111111-1111-1111-1111-111111111111",
  skill: "listening",
  source: "ai", tags: [], created_at: new Date().toISOString(),
  prompt: {
    audio_url: "/audio/x.mp3", audio_kind: "monologue", topic: "morning", jlpt_level: "N4",
    questions: [
      { question_english: "Q1?", options: ["a", "b", "c", "d"], answer_index: 0 },
      { question_english: "Q2?", options: ["a", "b", "c", "d"], answer_index: 1 },
    ],
  },
  answer: { transcript_ruby: "<ruby>朝<rt>あさ</rt></ruby>", translation_english: "morning" },
};

describe("ListeningCard", () => {
  it("grades got_it when ≥60% correct and reveals the transcript", () => {
    const onAnswer = vi.fn();
    render(<ListeningCard item={item} onAnswer={onAnswer} />);
    // Q1: pick correct option (index 0)
    fireEvent.click(screen.getAllByRole("button", { name: "a" })[0]);
    // advance to Q2, pick correct option (index 1)
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getAllByRole("button", { name: "b" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /finish|see|reveal|next/i }));
    expect(onAnswer).toHaveBeenCalledWith("got_it");
    expect(screen.getByText("morning")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w client -- ListeningCard`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `ListeningCard.tsx`**

```tsx
import { useState } from "react";
import type { ItemRecord, ListeningPrompt, ListeningAnswer, ReviewResult } from "@nihongo/shared";
import { RubyText } from "./RubyText";
import { SwipeDeck } from "./SwipeDeck";

type Props = { item: ItemRecord; onAnswer: (result: ReviewResult) => void };

const AUDIO_BASE = import.meta.env.VITE_API_BASE ?? "";
const PASS = 0.6; // fraction correct to count as got_it (mirrors explain)

export function ListeningCard({ item, onAnswer }: Props) {
  const prompt = item.prompt as ListeningPrompt;
  const answer = item.answer as ListeningAnswer;
  const [qi, setQi] = useState(0);
  const [picks, setPicks] = useState<number[]>([]);
  const [revealed, setRevealed] = useState(false);

  const q = prompt.questions[qi];
  const decided = picks[qi] !== undefined;
  const isLast = qi + 1 >= prompt.questions.length;

  function choose(i: number) {
    if (decided) return;
    setPicks((prev) => { const next = [...prev]; next[qi] = i; return next; });
  }

  function next() {
    if (isLast) {
      const correct = prompt.questions.reduce((n, qq, i) => n + (picks[i] === qq.answer_index ? 1 : 0), 0);
      onAnswer(correct / prompt.questions.length >= PASS ? "got_it" : "missed");
      setRevealed(true);
    } else {
      setQi(qi + 1);
    }
  }

  return (
    <SwipeDeck onSwipe={onAnswer} canSwipe={false} resetKey={item.id}>
      <div className="mc-card">
        <span className="flipcard__skill-chip">Listening</span>
        <audio controls src={`${AUDIO_BASE}${prompt.audio_url}`} className="listening-card__audio" />

        {!revealed ? (
          <>
            <p className="listening-card__q">{qi + 1}/{prompt.questions.length}. {q.question_english}</p>
            <div className="mc-card__options">
              {q.options.map((opt, i) => {
                const chosen = picks[qi];
                const isChosen = i === chosen;
                const isCorrect = i === q.answer_index;
                const cls = !decided ? "mc-option"
                  : isChosen && isCorrect ? "mc-option mc-option--correct"
                  : isChosen && !isCorrect ? "mc-option mc-option--wrong"
                  : isCorrect ? "mc-option mc-option--correct-reveal"
                  : "mc-option mc-option--muted";
                return (
                  <button key={i} type="button" className={cls} onClick={() => choose(i)} disabled={decided} aria-pressed={isChosen}>
                    {opt}
                    {decided && isCorrect && <span aria-hidden>✓</span>}
                    {decided && isChosen && !isCorrect && <span aria-hidden>✗</span>}
                  </button>
                );
              })}
            </div>
            {decided && (
              <button type="button" className="cta cta--primary cta--block" onClick={next}>
                {isLast ? "Finish →" : "Next question →"}
              </button>
            )}
          </>
        ) : (
          <div className="listening-card__reveal">
            <h3>Transcript</h3>
            <RubyText html={answer.transcript_ruby} className="ruby-hi-contrast" />
            <p className="muted">{answer.translation_english}</p>
          </div>
        )}
      </div>
    </SwipeDeck>
  );
}
```

- [ ] **Step 4: Dispatch in `PracticeScreen.tsx`** — import `ListeningCard`, and add a branch to the render dispatch (the `current.skill === …` chain):

```tsx
        ) : current.skill === "listening" ? (
          <ListeningCard key={current.id} item={current} onAnswer={handleAnswer} />
```

- [ ] **Step 5: Run tests**

Run: `npm test -w client -- ListeningCard`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ListeningCard.tsx client/src/components/ListeningCard.test.tsx client/src/screens/PracticeScreen.tsx
git commit -m "feat(client): ListeningCard with local MC grading + practice dispatch"
```

---

### Task 10: Full-suite + e2e verification

**Files:**
- Modify: `e2e/` — extend an existing practice spec or add `e2e/listening.spec.ts` (follow the existing Playwright patterns and the `NIHONGO_FAKE_AI=1` e2e harness)

**Interfaces:**
- Consumes: everything above. No new production code.

- [ ] **Step 1: Full unit suite**

Run: `npm test`
Expected: all workspaces green (shared/gen/server/client), including the new listening tests.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: shared → server → client compile with no type errors (the `Record<Skill, …>` maps and `by_skill` schemas force listening everywhere).

- [ ] **Step 3: e2e — generate + practice a listening card** (fake AI, no key needed)

Add a Playwright test that: authenticates, generates 1 listening item via the Settings generate form (or `POST /api/generate`), opens practice filtered to listening, asserts an `<audio>` element renders, answers the questions, and asserts the session summary appears. Follow the existing spec structure in `e2e/`.

Run: `npm run e2e`
Expected: the listening spec passes.

- [ ] **Step 4: Manual live check (real audio) — optional but recommended**

Deploy the branch to exe.dev (per project practice; no local docker), set a real `OPENAI_API_KEY`, generate a listening item, and confirm the MP3 actually plays and grading records a review. (In local/CI with `NIHONGO_FAKE_AI=1` the audio is a silent placeholder.)

- [ ] **Step 5: Commit**

```bash
git add e2e
git commit -m "test(e2e): generate and practice a listening card"
```

---

## Self-Review

**Spec coverage** (Phase 1 section of `2026-07-02-eva-lessons-listening-design.md`):
- `listening` in Skill enum + `ListeningPrompt`/`ListeningAnswer` + 7-skill `by_skill` → Task 1. ✅
- Migration widening `items.skill` CHECK → Task 2. ✅
- OpenAI TTS client + USD cost tracking → Task 3 (+ cost threaded in Task 5). ✅
- `AUDIO_DIR` + static serving (dev proxy + prod nginx) → Tasks 5–6. ✅
- Generation path (script → MC questions → TTS → furigana) → Tasks 4–5. ✅
- Wire `listening` into generate route/service → Task 5 (route already delegates to `runGeneration`; `GenerateRequest.skill` accepts any `Skill`, so no route change needed beyond the enum in Task 1). ✅
- Local MC grading ≥ 0.6 via existing `POST /api/reviews` → Task 9 (uses existing `submitReview` in `PracticeScreen`). ✅
- `ListeningCard` + practice flow → Task 9. ✅
- `skills.ts` + dashboard/stats/library to 7 skills → Tasks 7–8. ✅
- `item-display.ts` listening → Task 7. ✅
- Tests (types, parse, furigana-on-transcript, MC grading, item-display, generate route, TTS no-op) → Tasks 1,3,4,5,7,9,10. ✅ (Furigana on the transcript is exercised via the generate-service test in Task 5, which asserts a stored listening item; `toRubyHtml` is the same tested helper used by every skill.)

**Placeholder scan:** no TBD/TODO; every code step shows real code. The TTS price constant is an explicit estimate with a comment to verify against live billing — a real value, not a placeholder.

**Type consistency:** `ListeningGenItem` (gen) vs `ListeningPrompt`/`ListeningAnswer` (shared) are intentionally distinct — the generator emits `segments` + `transcript_japanese` (raw), and `enrichFor` maps them to the stored `audio_url` + `transcript_ruby` shapes. `synthesizeSpeech`/`Segment`, `saveAudio`, `computeTtsCost` names are used identically across Tasks 3/5. `Enriched.audio_cost_usd` defined in Task 5 is consumed in the same task.

## Execution Handoff

Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.
