# Phase 1.5 AI Top-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner top up the deck with AI-generated vocab via a Settings screen and a Today empty-state form, persisting an audit row per generation.

**Architecture:** Extract Claude+kuromoji code into a new `@nihongo/gen` workspace shared by the seed importer and a new `/api/generate` route. Add a `generations` audit table. Add a `<GenerateForm>` React component used in two modes by `SettingsScreen` and the `TodayScreen` empty state.

**Tech Stack:** TypeScript, Express, pg, zod, Anthropic SDK, kuromoji, React, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-05-06-phase-1-5-ai-topup-design.md`](../specs/2026-05-06-phase-1-5-ai-topup-design.md)

---

## File map

**New workspace package: `gen/`**
- `gen/package.json` — declares `@nihongo/gen`, owns `@anthropic-ai/sdk` and `kuromoji` deps
- `gen/tsconfig.json`, `gen/vitest.config.ts`
- `gen/src/pricing.ts` — `MODEL`, per-MTok rates, `computeCost(usage)`
- `gen/src/prompt.ts` — `buildVocabPrompt({count, weakness_hint})`, `buildSentencesForCardsPrompt(cards)`
- `gen/src/parse.ts` — `parseVocabBatch(raw)`, `parseSentencesForCards(raw)`, `stripFences`
- `gen/src/furigana.ts` — moved verbatim from seed (kuromoji singleton, `toRubyHtml`, `readingFor`)
- `gen/src/generate.ts` — `generateVocabBatch`, `generateSentencesForCards`, `GenerateError`, fake-AI hook
- `gen/src/*.test.ts` — one test file per module above

**Modified workspace: `seed/`**
- `seed/src/generate.ts` — DELETED (replaced by `@nihongo/gen`)
- `seed/src/furigana.ts` — DELETED
- `seed/src/generate.test.ts` — DELETED (gen/ now owns these)
- `seed/src/import.ts` — re-imports from `@nihongo/gen`
- `seed/package.json` — drops `@anthropic-ai/sdk` + `kuromoji`, adds `@nihongo/gen`

**New migration**
- `db/migrations/1778457600000_generations_table.sql`

**Shared schemas**
- `shared/src/types.ts` — adds `GenerateRequest`, `GenerateResponse`, `GenerationsResponse`, `SettingsStatusResponse`

**New server modules**
- `server/src/services/generate.ts` — orchestrates gen.generateVocabBatch → ruby/reading → tx insert
- `server/src/routes/generate.ts` — `POST /api/generate`
- `server/src/routes/generations.ts` — `GET /api/generations`
- `server/src/routes/settings.ts` — `GET /api/settings/status`
- `server/src/services/generate.test.ts`, `server/src/routes/generate.test.ts`, `server/src/routes/generations.test.ts`, `server/src/routes/settings.test.ts`

**Modified server modules**
- `server/src/index.ts` — mount three new routers
- `server/src/db/reset.ts` — also TRUNCATE `generations`

**New client modules**
- `client/src/components/GenerateForm.tsx` — `mode: "full" | "compact"`
- `client/src/screens/SettingsScreen.tsx`

**Modified client modules**
- `client/src/api-hooks.ts` — `generateItems`, `fetchGenerations`, `fetchSettingsStatus`
- `client/src/screens/TodayScreen.tsx` — Settings link in header, compact GenerateForm in empty state, queue invalidation
- `client/src/App.tsx` — `"settings"` becomes a Tab value; bottom-tab list unchanged

**E2E**
- `e2e/tests/fixtures/seed-test-empty.sql` — TRUNCATE only
- `e2e/tests/generate.spec.ts`
- `e2e/playwright.config.ts` — unchanged (env var lives on the dev server)

**Root**
- `package.json` — workspaces array adds `"gen"`; add `dev:e2e` script

---

# Phase A: Extract `@nihongo/gen`

### Task 1: Create gen workspace skeleton

**Files:**
- Create: `gen/package.json`
- Create: `gen/tsconfig.json`
- Create: `gen/vitest.config.ts`
- Modify: `package.json` (root)

- [ ] **Step 1: Create the package.json**

Write `gen/package.json`:

```json
{
  "name": "@nihongo/gen",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "kuromoji": "^0.1.2"
  },
  "devDependencies": {
    "@types/kuromoji": "^0.1.3",
    "@types/node": "^22.7.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig**

Write `gen/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create vitest config**

Write `gen/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
```

(Long timeout because `furigana.test.ts` builds the kuromoji tokenizer ~1–2s on first run.)

- [ ] **Step 4: Register the workspace and update root test script**

Edit `package.json` (root) — change the `workspaces` array and the `test` script:

```json
{
  "workspaces": ["shared", "gen", "server", "client", "e2e", "seed"],
  "scripts": {
    "dev": "npm --workspace server run dev & npm --workspace client run dev",
    "build": "npm --workspace shared run build && npm --workspace server run build && npm --workspace client run build",
    "test": "npm --workspace shared test --if-present && npm --workspace gen test && npm --workspace seed test && npm --workspace server test",
    "e2e": "npm --workspace e2e test",
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down",
    "db:migrate": "npm --workspace server run db:migrate"
  }
}
```

- [ ] **Step 5: Create a placeholder src/index.ts so `npm install` doesn't choke**

Write `gen/src/index.ts`:

```ts
export {};
```

- [ ] **Step 6: Install workspaces**

Run: `npm install`
Expected: writes `node_modules/@nihongo/gen` symlink, no errors.

- [ ] **Step 7: Commit**

```bash
git add gen/ package.json package-lock.json
git commit -m "feat(gen): scaffold @nihongo/gen workspace"
```

---

### Task 2: Add `gen/src/pricing.ts`

**Files:**
- Create: `gen/src/pricing.ts`
- Create: `gen/src/pricing.test.ts`

- [ ] **Step 1: Write the failing test**

Write `gen/src/pricing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeCost, MODEL, INPUT_PER_MTOK, OUTPUT_PER_MTOK } from "./pricing.js";

describe("pricing", () => {
  it("exports the sonnet model id and per-MTok rates", () => {
    expect(MODEL).toMatch(/sonnet/);
    expect(INPUT_PER_MTOK).toBe(3.0);
    expect(OUTPUT_PER_MTOK).toBe(15.0);
  });

  it("computes cost from usage", () => {
    // 1000 input * $3/1M + 500 output * $15/1M = 0.003 + 0.0075 = 0.0105
    expect(computeCost({ input_tokens: 1000, output_tokens: 500 })).toBeCloseTo(0.0105, 6);
  });

  it("returns 0 for zero usage", () => {
    expect(computeCost({ input_tokens: 0, output_tokens: 0 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace gen test`
Expected: FAIL — `Cannot find module './pricing.js'`.

- [ ] **Step 3: Implement pricing.ts**

Write `gen/src/pricing.ts`:

```ts
export const MODEL = "claude-sonnet-4-6";

// Pricing per 1M tokens (sonnet 4.6, USD).
export const INPUT_PER_MTOK = 3.0;
export const OUTPUT_PER_MTOK = 15.0;

export type Usage = { input_tokens: number; output_tokens: number };

export function computeCost(usage: Usage): number {
  return (usage.input_tokens / 1_000_000) * INPUT_PER_MTOK
       + (usage.output_tokens / 1_000_000) * OUTPUT_PER_MTOK;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace gen test`
Expected: PASS — 3 passing.

- [ ] **Step 5: Commit**

```bash
git add gen/src/pricing.ts gen/src/pricing.test.ts
git commit -m "feat(gen): pricing module with cost calculator"
```

---

### Task 3: Add `gen/src/parse.ts`

**Files:**
- Create: `gen/src/parse.ts`
- Create: `gen/src/parse.test.ts`

- [ ] **Step 1: Write the failing test**

Write `gen/src/parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseVocabBatch, parseSentencesForCards, stripFences } from "./parse.js";

describe("stripFences", () => {
  it("strips ```json fences", () => {
    expect(stripFences("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
  });
  it("strips bare ``` fences", () => {
    expect(stripFences("```\n{\"a\":1}\n```")).toBe('{"a":1}');
  });
  it("returns trimmed input when no fences", () => {
    expect(stripFences("  {\"a\":1}  ")).toBe('{"a":1}');
  });
});

describe("parseVocabBatch", () => {
  it("returns items with target/sentence_japanese/sentence_english", () => {
    const raw = JSON.stringify({
      items: [
        { target: "本", sentence_japanese: "私は本を読みます。", sentence_english: "I read a book." },
        { target: "水", sentence_japanese: "水を飲みます。", sentence_english: "I drink water." },
      ],
    });
    expect(parseVocabBatch(raw)).toEqual([
      { target: "本", sentence_japanese: "私は本を読みます。", sentence_english: "I read a book." },
      { target: "水", sentence_japanese: "水を飲みます。", sentence_english: "I drink water." },
    ]);
  });

  it("strips ```json code fences before parsing", () => {
    const inner = JSON.stringify({
      items: [{ target: "本", sentence_japanese: "本。", sentence_english: "A book." }],
    });
    expect(parseVocabBatch("```json\n" + inner + "\n```")).toHaveLength(1);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseVocabBatch("not json")).toThrow();
  });

  it("throws when entries are missing required fields", () => {
    expect(() => parseVocabBatch(JSON.stringify({ items: [{ target: "本" }] }))).toThrow();
  });

  it("throws when items is not an array", () => {
    expect(() => parseVocabBatch(JSON.stringify({ items: "nope" }))).toThrow();
  });
});

describe("parseSentencesForCards", () => {
  it("returns sentences keyed by external_id", () => {
    const raw = JSON.stringify({
      sentences: [
        { external_id: "a", sentence_japanese: "本。", sentence_english: "A book." },
      ],
    });
    expect(parseSentencesForCards(raw)).toEqual([
      { external_id: "a", sentence_japanese: "本。", sentence_english: "A book." },
    ]);
  });

  it("throws on malformed entries", () => {
    expect(() => parseSentencesForCards(JSON.stringify({ sentences: [{ external_id: "a" }] }))).toThrow();
  });

  it("strips code fences", () => {
    const inner = JSON.stringify({
      sentences: [{ external_id: "a", sentence_japanese: "本。", sentence_english: "A book." }],
    });
    expect(parseSentencesForCards("```json\n" + inner + "\n```")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace gen test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement parse.ts**

Write `gen/src/parse.ts`:

```ts
export type VocabItem = {
  target: string;
  sentence_japanese: string;
  sentence_english: string;
};

export type SentenceForCard = {
  external_id: string;
  sentence_japanese: string;
  sentence_english: string;
};

export function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

export function parseVocabBatch(raw: string): VocabItem[] {
  const parsed = JSON.parse(stripFences(raw));
  const items = parsed?.items;
  if (!Array.isArray(items)) throw new Error("response missing 'items' array");
  for (const it of items) {
    if (
      typeof it?.target !== "string" ||
      typeof it?.sentence_japanese !== "string" ||
      typeof it?.sentence_english !== "string"
    ) {
      throw new Error("response item missing required fields");
    }
  }
  return items as VocabItem[];
}

export function parseSentencesForCards(raw: string): SentenceForCard[] {
  const parsed = JSON.parse(stripFences(raw));
  const sentences = parsed?.sentences;
  if (!Array.isArray(sentences)) throw new Error("response missing 'sentences' array");
  for (const s of sentences) {
    if (
      typeof s?.external_id !== "string" ||
      typeof s?.sentence_japanese !== "string" ||
      typeof s?.sentence_english !== "string"
    ) {
      throw new Error("response entry missing required fields");
    }
  }
  return sentences as SentenceForCard[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace gen test`
Expected: PASS — all parse tests green.

- [ ] **Step 5: Commit**

```bash
git add gen/src/parse.ts gen/src/parse.test.ts
git commit -m "feat(gen): JSON response parsers"
```

---

### Task 4: Add `gen/src/prompt.ts`

**Files:**
- Create: `gen/src/prompt.ts`
- Create: `gen/src/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Write `gen/src/prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildVocabPrompt, buildSentencesForCardsPrompt } from "./prompt.js";

describe("buildVocabPrompt", () => {
  it("asks for the requested count and returns strict JSON instructions", () => {
    const { system, user } = buildVocabPrompt({ count: 7 });
    expect(system).toMatch(/JSON/i);
    expect(system).toContain('"items"');
    expect(system).toContain('"target"');
    expect(user).toContain("7");
  });

  it("includes the weakness hint verbatim when provided", () => {
    const { user } = buildVocabPrompt({ count: 5, weakness_hint: "verbs for cooking" });
    expect(user).toContain("verbs for cooking");
  });

  it("omits hint phrasing when no hint is provided", () => {
    const { user } = buildVocabPrompt({ count: 5 });
    expect(user.toLowerCase()).not.toContain("focus on");
  });
});

describe("buildSentencesForCardsPrompt", () => {
  it("includes each card's id and japanese term", () => {
    const { system, user } = buildSentencesForCardsPrompt([
      { external_id: "x1", japanese: "本", english: "book" },
      { external_id: "x2", japanese: "水", english: "water" },
    ]);
    expect(system).toContain('"sentences"');
    expect(user).toContain("id=x1");
    expect(user).toContain("本");
    expect(user).toContain("water");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace gen test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement prompt.ts**

Write `gen/src/prompt.ts`:

```ts
export type CardInput = {
  external_id: string;
  japanese: string;
  english: string;
};

export type PromptPair = { system: string; user: string };

const VOCAB_SYSTEM = `You generate beginner-to-intermediate Japanese vocabulary cards. For each card, output one common word and one short natural example sentence (under 20 syllables) that uses it. Vary parts of speech (nouns, verbs, adjectives) across the batch unless the user's hint constrains otherwise.
Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "items": [ { "target": "<word>", "sentence_japanese": "<JA>", "sentence_english": "<EN>" } ] }`;

export function buildVocabPrompt(args: { count: number; weakness_hint?: string }): PromptPair {
  const lines: string[] = [`Generate ${args.count} vocabulary cards.`];
  if (args.weakness_hint && args.weakness_hint.trim().length > 0) {
    lines.push(`Focus on: ${args.weakness_hint.trim()}`);
  }
  return { system: VOCAB_SYSTEM, user: lines.join("\n") };
}

const SENTENCES_FOR_CARDS_SYSTEM = `You write a single natural everyday Japanese example sentence for each vocabulary word given.
The sentence MUST contain the target word verbatim. Keep it short (under 20 syllables) and use common modern Japanese.
Reply ONLY with valid JSON matching this exact schema:
{ "sentences": [ { "external_id": "<id>", "sentence_japanese": "<JA>", "sentence_english": "<EN>" } ] }
No commentary. No code fences.`;

export function buildSentencesForCardsPrompt(cards: CardInput[]): PromptPair {
  const user = [
    "Generate one example sentence per word:",
    ...cards.map((c) => `- id=${c.external_id}: ${c.japanese} (${c.english})`),
  ].join("\n");
  return { system: SENTENCES_FOR_CARDS_SYSTEM, user };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace gen test`
Expected: PASS — prompt tests green.

- [ ] **Step 5: Commit**

```bash
git add gen/src/prompt.ts gen/src/prompt.test.ts
git commit -m "feat(gen): vocab + sentences-for-cards prompt builders"
```

---

### Task 5: Move `furigana.ts` from seed to gen

**Files:**
- Create: `gen/src/furigana.ts`
- Create: `gen/src/furigana.test.ts`
- (Existing seed copy stays in place until Task 8 deletes it.)

- [ ] **Step 1: Write the test first**

Write `gen/src/furigana.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toRubyHtml, readingFor } from "./furigana.js";

describe("toRubyHtml", () => {
  it("wraps kanji surface forms in <ruby>", async () => {
    const html = await toRubyHtml("本を読みます。");
    expect(html).toContain("<ruby>本<rt>");
    expect(html).toContain("<ruby>読<rt>");
  });

  it("does not wrap kana-only segments", async () => {
    const html = await toRubyHtml("ありがとう");
    expect(html).not.toContain("<ruby>");
    expect(html).toContain("ありがとう");
  });
});

describe("readingFor", () => {
  it("returns the hiragana reading of a kanji term", async () => {
    const r = await readingFor("水");
    expect(r).toBe("みず");
  });

  it("returns the input itself for a kana-only term", async () => {
    const r = await readingFor("ありがとう");
    expect(r).toBe("ありがとう");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace gen test`
Expected: FAIL — module not found.

- [ ] **Step 3: Copy the existing implementation from seed/src/furigana.ts**

Write `gen/src/furigana.ts`:

```ts
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import kuromoji from "kuromoji";

type Tokenizer = {
  tokenize(text: string): Array<{
    surface_form: string;
    reading?: string;
    pos?: string;
  }>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DICT_DIR = path.resolve(__dirname, "../../node_modules/kuromoji/dict");

let cached: Tokenizer | null = null;

export async function getTokenizer(): Promise<Tokenizer> {
  if (cached) return cached;
  const build = promisify((cb: (err: Error | null, t: Tokenizer | undefined) => void) => {
    kuromoji.builder({ dicPath: DICT_DIR }).build(cb);
  });
  const t = await build();
  if (!t) throw new Error("kuromoji failed to build tokenizer");
  cached = t;
  return t;
}

const KATAKANA_TO_HIRAGANA = (s: string): string =>
  s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

const HAS_KANJI = /[一-龯]/;

export async function toRubyHtml(text: string): Promise<string> {
  const tok = await getTokenizer();
  const tokens = tok.tokenize(text);
  let out = "";
  for (const t of tokens) {
    if (HAS_KANJI.test(t.surface_form) && t.reading) {
      const hira = KATAKANA_TO_HIRAGANA(t.reading);
      out += `<ruby>${escapeHtml(t.surface_form)}<rt>${escapeHtml(hira)}</rt></ruby>`;
    } else {
      out += escapeHtml(t.surface_form);
    }
  }
  return out;
}

export async function readingFor(word: string): Promise<string> {
  const tok = await getTokenizer();
  const tokens = tok.tokenize(word);
  return tokens.map((t) => t.reading ? KATAKANA_TO_HIRAGANA(t.reading) : t.surface_form).join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace gen test`
Expected: PASS — furigana tests green (the first run will take ~1–2s while kuromoji builds).

- [ ] **Step 5: Commit**

```bash
git add gen/src/furigana.ts gen/src/furigana.test.ts
git commit -m "feat(gen): port furigana module from seed"
```

---

### Task 6: Add `gen/src/generate.ts`

**Files:**
- Create: `gen/src/generate.ts`
- Create: `gen/src/generate.test.ts`
- Modify: `gen/src/index.ts` (re-export the public surface)

- [ ] **Step 1: Write the failing test**

Write `gen/src/generate.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  generateVocabBatch,
  generateSentencesForCards,
  GenerateError,
} from "./generate.js";

function fakeClient(responses: Array<{ text: string; in?: number; out?: number }>) {
  const create = vi.fn();
  for (const r of responses) {
    create.mockResolvedValueOnce({
      content: [{ type: "text", text: r.text }],
      usage: { input_tokens: r.in ?? 100, output_tokens: r.out ?? 50 },
    });
  }
  return { client: { messages: { create } } as never, create };
}

describe("generateVocabBatch", () => {
  it("returns parsed items + accumulated usage on the first attempt", async () => {
    const { client, create } = fakeClient([{
      text: JSON.stringify({
        items: [
          { target: "本", sentence_japanese: "本を読む。", sentence_english: "Read a book." },
          { target: "水", sentence_japanese: "水を飲む。", sentence_english: "Drink water." },
        ],
      }),
      in: 120, out: 60,
    }]);
    const r = await generateVocabBatch({ count: 2, client });
    expect(r.items.map((i) => i.target)).toEqual(["本", "水"]);
    expect(r.usage).toEqual({ input_tokens: 120, output_tokens: 60 });
    expect(typeof r.raw).toBe("string");
    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0]![0];
    expect(arg.model).toMatch(/sonnet/);
    expect(arg.messages[0].content).toContain("2");
  });

  it("retries on parse failure and returns success when a later attempt parses", async () => {
    const ok = JSON.stringify({
      items: [{ target: "本", sentence_japanese: "本。", sentence_english: "A book." }],
    });
    const { client, create } = fakeClient([
      { text: "garbage", in: 10, out: 5 },
      { text: ok, in: 10, out: 5 },
    ]);
    const r = await generateVocabBatch({ count: 1, client });
    expect(create).toHaveBeenCalledTimes(2);
    expect(r.items).toHaveLength(1);
    // Usage accumulates across all attempts (we billed for both calls).
    expect(r.usage).toEqual({ input_tokens: 20, output_tokens: 10 });
  });

  it("throws GenerateError carrying accumulated usage and last raw text after retries exhausted", async () => {
    const { client, create } = fakeClient([
      { text: "garbage1", in: 10, out: 5 },
      { text: "garbage2", in: 10, out: 5 },
      { text: "garbage3", in: 10, out: 5 },
    ]);
    let err: unknown;
    try { await generateVocabBatch({ count: 1, client }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(GenerateError);
    const ge = err as GenerateError;
    expect(ge.usage).toEqual({ input_tokens: 30, output_tokens: 15 });
    expect(ge.raw).toBe("garbage3");
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("includes the weakness hint in the user prompt when provided", async () => {
    const { client, create } = fakeClient([{
      text: JSON.stringify({ items: [
        { target: "本", sentence_japanese: "本。", sentence_english: "A book." },
      ]}),
    }]);
    await generateVocabBatch({ count: 1, weakness_hint: "verbs for cooking", client });
    const arg = create.mock.calls[0]![0];
    expect(arg.messages[0].content).toContain("verbs for cooking");
  });

  it("returns a deterministic fixture when NIHONGO_FAKE_AI=1", async () => {
    const prev = process.env.NIHONGO_FAKE_AI;
    process.env.NIHONGO_FAKE_AI = "1";
    try {
      const r = await generateVocabBatch({ count: 3 });
      expect(r.items).toHaveLength(3);
      // Fixture must always include `target` and a Japanese sentence.
      for (const it of r.items) {
        expect(typeof it.target).toBe("string");
        expect(it.target.length).toBeGreaterThan(0);
        expect(it.sentence_japanese.length).toBeGreaterThan(0);
        expect(it.sentence_english.length).toBeGreaterThan(0);
      }
      expect(r.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
    } finally {
      if (prev === undefined) delete process.env.NIHONGO_FAKE_AI;
      else process.env.NIHONGO_FAKE_AI = prev;
    }
  });

  it("clamps fixture length to the requested count", async () => {
    const prev = process.env.NIHONGO_FAKE_AI;
    process.env.NIHONGO_FAKE_AI = "1";
    try {
      const r = await generateVocabBatch({ count: 1 });
      expect(r.items).toHaveLength(1);
    } finally {
      if (prev === undefined) delete process.env.NIHONGO_FAKE_AI;
      else process.env.NIHONGO_FAKE_AI = prev;
    }
  });
});

describe("generateSentencesForCards", () => {
  it("returns parsed sentences", async () => {
    const { client } = fakeClient([{
      text: JSON.stringify({
        sentences: [
          { external_id: "a", sentence_japanese: "本。", sentence_english: "A book." },
        ],
      }),
    }]);
    const r = await generateSentencesForCards(
      [{ external_id: "a", japanese: "本", english: "book" }],
      { client },
    );
    expect(r.sentences).toHaveLength(1);
    expect(r.usage.input_tokens).toBe(100);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace gen test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement generate.ts**

Write `gen/src/generate.ts`:

```ts
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
```

- [ ] **Step 4: Update gen/src/index.ts to re-export the public surface**

Replace `gen/src/index.ts`:

```ts
export { computeCost, MODEL, INPUT_PER_MTOK, OUTPUT_PER_MTOK, type Usage } from "./pricing.js";
export { stripFences, parseVocabBatch, parseSentencesForCards, type VocabItem, type SentenceForCard } from "./parse.js";
export { buildVocabPrompt, buildSentencesForCardsPrompt, type CardInput } from "./prompt.js";
export { toRubyHtml, readingFor, getTokenizer } from "./furigana.js";
export {
  generateVocabBatch,
  generateSentencesForCards,
  GenerateError,
} from "./generate.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm --workspace gen test`
Expected: PASS — all gen/ tests green (>15 cases).

- [ ] **Step 6: Commit**

```bash
git add gen/src/generate.ts gen/src/generate.test.ts gen/src/index.ts
git commit -m "feat(gen): generateVocabBatch, generateSentencesForCards, fake-AI hook"
```

---

### Task 7: Migrate seed/ to import from `@nihongo/gen`

**Files:**
- Modify: `seed/package.json`
- Modify: `seed/src/import.ts`
- Delete: `seed/src/generate.ts`
- Delete: `seed/src/generate.test.ts`
- Delete: `seed/src/furigana.ts`

- [ ] **Step 1: Update seed/package.json**

Replace `seed/package.json`:

```json
{
  "name": "@nihongo/seed",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "import": "tsx src/import.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@nihongo/shared": "*",
    "@nihongo/gen": "*",
    "dotenv": "^16.4.5",
    "fast-xml-parser": "^4.5.0",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "@types/pg": "^8.11.10",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Rewrite seed/src/import.ts to consume gen + computeCost**

Replace `seed/src/import.ts`:

```ts
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
```

- [ ] **Step 3: Delete the now-duplicated seed files**

Run:

```bash
rm seed/src/generate.ts seed/src/generate.test.ts seed/src/furigana.ts
```

- [ ] **Step 4: Reinstall workspaces**

Run: `npm install`
Expected: refreshes `node_modules/@nihongo/seed`, no errors.

- [ ] **Step 5: Run seed tests to confirm only parse-xml is left and passes**

Run: `npm --workspace seed test`
Expected: PASS — `parse-xml.test.ts` still green; no other test files.

- [ ] **Step 6: Commit**

```bash
git add seed/ package-lock.json
git commit -m "refactor(seed): consume @nihongo/gen for prompts and furigana"
```

---

# Phase B: Server APIs

### Task 8: Add the `generations` migration and update reset

**Files:**
- Create: `db/migrations/1778457600000_generations_table.sql`
- Modify: `server/src/db/reset.ts`

- [ ] **Step 1: Write the migration**

Write `db/migrations/1778457600000_generations_table.sql`:

```sql
-- 1778457600000_generations_table.sql
-- Phase 1.5: audit row per AI top-up generation. The `prompt` and `response`
-- jsonb columns capture the full request/response text so post-mortem on a
-- bad batch is possible in SQL without re-running the call.

CREATE TABLE generations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  skill           text NOT NULL DEFAULT 'vocab',
  count_requested integer NOT NULL,
  count_inserted  integer NOT NULL DEFAULT 0,
  weakness_hint   text,
  model           text NOT NULL,
  prompt          jsonb NOT NULL,
  response        jsonb,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  cost_usd        numeric(10,6) NOT NULL DEFAULT 0,
  status          text NOT NULL CHECK (status IN ('success','partial','failed')),
  error           text
);

CREATE INDEX generations_requested_at_idx ON generations(requested_at DESC);
```

- [ ] **Step 2: Update db/reset.ts to also TRUNCATE generations**

Replace `server/src/db/reset.ts`:

```ts
import { pool } from "./pool.js";

// Truncates application tables in FK order. Use in test beforeEach.
// pgmigrations is left alone so the schema stays migrated.
export async function resetDb(): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE reviews, review_state, items, sessions, generations
    RESTART IDENTITY CASCADE
  `);
}
```

- [ ] **Step 3: Apply the migration locally**

Run: `npm run db:up && npm run db:migrate`
Expected: migration `1778457600000_generations_table` applied; `generations` table exists.

Verify:

```bash
psql "$DATABASE_URL" -c "\d generations"
```

Expected: shows columns matching the migration.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/1778457600000_generations_table.sql server/src/db/reset.ts
git commit -m "feat(db): generations audit table"
```

---

### Task 9: Add zod schemas to `@nihongo/shared`

**Files:**
- Modify: `shared/src/types.ts`

- [ ] **Step 1: Append the new schemas**

Edit `shared/src/types.ts` — append after the existing `StreakResponse` block:

```ts
// ----- API: generate -----

export const GenerateRequest = z.object({
  skill: z.literal("vocab"),
  count: z.number().int().min(1).max(50),
  weakness_hint: z.string().max(200).optional(),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;

export const GenerateSuccess = z.object({
  generation_id: z.string().uuid(),
  status: z.enum(["success", "partial"]),
  items_created: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  items: z.array(ItemRecord),
});
export type GenerateSuccess = z.infer<typeof GenerateSuccess>;

export const GenerateFailure = z.object({
  generation_id: z.string().uuid(),
  status: z.literal("failed"),
  items_created: z.literal(0),
  cost_usd: z.number().nonnegative(),
  error: z.string(),
});
export type GenerateFailure = z.infer<typeof GenerateFailure>;

// ----- API: generations list -----

export const GenerationSummary = z.object({
  id: z.string().uuid(),
  requested_at: z.string(),       // ISO
  skill: z.string(),
  count_requested: z.number().int().nonnegative(),
  count_inserted: z.number().int().nonnegative(),
  weakness_hint: z.string().nullable(),
  cost_usd: z.number().nonnegative(),
  status: z.enum(["success", "partial", "failed"]),
  error: z.string().nullable(),
});
export type GenerationSummary = z.infer<typeof GenerationSummary>;

export const GenerationsResponse = z.object({
  generations: z.array(GenerationSummary),
});
export type GenerationsResponse = z.infer<typeof GenerationsResponse>;

// ----- API: settings status -----

export const SettingsStatusResponse = z.object({
  ai_key_configured: z.boolean(),
});
export type SettingsStatusResponse = z.infer<typeof SettingsStatusResponse>;
```

- [ ] **Step 2: Verify the shared build still passes**

Run: `npm --workspace shared run build`
Expected: PASS — no TS errors.

- [ ] **Step 3: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat(shared): zod schemas for /api/generate, generations, settings status"
```

---

### Task 10: Add `services/generate.ts` orchestrator

**Files:**
- Create: `server/src/services/generate.ts`
- Create: `server/src/services/generate.test.ts`
- Modify: `server/package.json` — depend on `@nihongo/gen`

- [ ] **Step 1: Add @nihongo/gen as a server dependency**

Edit `server/package.json` — add `"@nihongo/gen": "*"` to `dependencies` (alphabetically between `@nihongo/shared` and `express`):

```json
{
  "dependencies": {
    "@nihongo/shared": "*",
    "@nihongo/gen": "*",
    "express": "^4.21.0",
    "pg": "^8.13.0",
    "zod": "^3.23.8",
    "node-pg-migrate": "^7.6.1"
  }
}
```

- [ ] **Step 2: Run npm install to refresh the workspace symlinks**

Run: `npm install`
Expected: no errors.

- [ ] **Step 3: Write the failing test**

Write `server/src/services/generate.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { runVocabGeneration } from "./generate.js";

beforeEach(() => resetDb());

function fakeGenClient(items: Array<{ target: string; sentence_japanese: string; sentence_english: string }>) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify({ items }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  };
}

describe("runVocabGeneration", () => {
  it("inserts one item per parsed entry, writes a success row, returns inserted items", async () => {
    const client = fakeGenClient([
      { target: "本", sentence_japanese: "本を読む。", sentence_english: "Read a book." },
      { target: "水", sentence_japanese: "水を飲む。", sentence_english: "Drink water." },
    ]);
    const r = await runVocabGeneration({ count: 2, client });
    expect(r.status).toBe("success");
    expect(r.items_created).toBe(2);
    expect(r.items).toHaveLength(2);
    expect(r.cost_usd).toBeGreaterThan(0);

    const items = await pool.query("SELECT source, prompt, answer FROM items");
    expect(items.rowCount).toBe(2);
    expect(items.rows[0].source).toBe("ai");
    expect(items.rows[0].prompt.sentence_ruby).toContain("<ruby>");
    expect(items.rows[0].answer.reading).toMatch(/^[ぁ-ゖー]+$/);

    const gens = await pool.query("SELECT status, count_requested, count_inserted, cost_usd, response, prompt FROM generations");
    expect(gens.rowCount).toBe(1);
    expect(gens.rows[0].status).toBe("success");
    expect(gens.rows[0].count_requested).toBe(2);
    expect(gens.rows[0].count_inserted).toBe(2);
    expect(gens.rows[0].response).not.toBeNull();
    expect(gens.rows[0].prompt).toMatchObject({ system: expect.any(String), user: expect.any(String) });
  });

  it("marks status=partial when fewer items are returned than requested", async () => {
    const client = fakeGenClient([
      { target: "本", sentence_japanese: "本。", sentence_english: "A book." },
    ]);
    const r = await runVocabGeneration({ count: 3, client });
    expect(r.status).toBe("partial");
    expect(r.items_created).toBe(1);
    const gens = await pool.query("SELECT status FROM generations");
    expect(gens.rows[0].status).toBe("partial");
  });

  it("writes a failed row and rethrows when generation fails", async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "garbage" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      },
    };
    let err: unknown;
    try { await runVocabGeneration({ count: 2, client }); } catch (e) { err = e; }
    expect(err).toBeDefined();
    const items = await pool.query("SELECT count(*)::int AS c FROM items");
    expect(items.rows[0].c).toBe(0);
    const gens = await pool.query("SELECT status, count_inserted, error, response, input_tokens FROM generations");
    expect(gens.rowCount).toBe(1);
    expect(gens.rows[0].status).toBe("failed");
    expect(gens.rows[0].count_inserted).toBe(0);
    expect(gens.rows[0].input_tokens).toBe(30); // 3 attempts × 10 tokens
    expect(gens.rows[0].error).toBeTruthy();
    expect(gens.rows[0].response).toMatchObject({ text: "garbage" });
  });

  it("stores the weakness_hint when provided", async () => {
    const client = fakeGenClient([
      { target: "本", sentence_japanese: "本。", sentence_english: "A book." },
    ]);
    await runVocabGeneration({ count: 1, weakness_hint: "particles", client });
    const gens = await pool.query("SELECT weakness_hint FROM generations");
    expect(gens.rows[0].weakness_hint).toBe("particles");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm --workspace server test`
Expected: FAIL — `runVocabGeneration` does not exist.

- [ ] **Step 5: Implement services/generate.ts**

Write `server/src/services/generate.ts`:

```ts
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

export type RunResult =
  | {
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm --workspace server test -- generate`
Expected: PASS — 4 service tests green.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/generate.ts server/src/services/generate.test.ts server/package.json package-lock.json
git commit -m "feat(server): runVocabGeneration orchestrator"
```

---

### Task 11: Add `routes/generate.ts`

**Files:**
- Create: `server/src/routes/generate.ts`
- Create: `server/src/routes/generate.test.ts`

- [ ] **Step 1: Write the failing test**

Write `server/src/routes/generate.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { generateRouter } from "./generate.js";

const PASSCODE = "test-passcode";

// Test app uses NIHONGO_FAKE_AI hooked into runVocabGeneration via the gen-package fixture.
const app = makeTestApp(PASSCODE, (a) => a.use("/api/generate", generateRouter));

beforeEach(async () => {
  await resetDb();
  process.env.NIHONGO_FAKE_AI = "1";
});

describe("POST /api/generate", () => {
  it("requires passcode", async () => {
    const res = await request(app).post("/api/generate").send({ skill: "vocab", count: 1 });
    expect(res.status).toBe(401);
  });

  it("inserts items and returns them on success", async () => {
    const res = await request(app)
      .post("/api/generate")
      .set("X-Passcode", PASSCODE)
      .send({ skill: "vocab", count: 2 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.items_created).toBe(2);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.cost_usd).toBe(0); // fake AI reports no usage
    expect(res.body.generation_id).toMatch(/^[0-9a-f-]{36}$/);

    const items = await pool.query("SELECT count(*)::int AS c FROM items WHERE source='ai'");
    expect(items.rows[0].c).toBe(2);
  });

  it("rejects count=0 with 400", async () => {
    const res = await request(app)
      .post("/api/generate").set("X-Passcode", PASSCODE)
      .send({ skill: "vocab", count: 0 });
    expect(res.status).toBe(400);
  });

  it("rejects count=51 with 400", async () => {
    const res = await request(app)
      .post("/api/generate").set("X-Passcode", PASSCODE)
      .send({ skill: "vocab", count: 51 });
    expect(res.status).toBe(400);
  });

  it("rejects missing skill with 400", async () => {
    const res = await request(app)
      .post("/api/generate").set("X-Passcode", PASSCODE)
      .send({ count: 5 });
    expect(res.status).toBe(400);
  });

  it("rejects weakness_hint > 200 chars with 400", async () => {
    const res = await request(app)
      .post("/api/generate").set("X-Passcode", PASSCODE)
      .send({ skill: "vocab", count: 5, weakness_hint: "x".repeat(201) });
    expect(res.status).toBe(400);
  });

  it("returns 502 + failed row when the orchestrator throws", async () => {
    delete process.env.NIHONGO_FAKE_AI;
    // Build a server-side runner that always throws, by monkeypatching the module.
    // Instead, we exercise the real path with a mocked Anthropic call via NIHONGO_FAKE_AI=2 (unset).
    // Because runVocabGeneration is wired with no client and no real key in tests,
    // the SDK will throw on instantiation, which the route should map to 502.
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await request(app)
        .post("/api/generate").set("X-Passcode", PASSCODE)
        .send({ skill: "vocab", count: 2 });
      expect(res.status).toBe(502);
      expect(res.body.status).toBe("failed");
      expect(res.body.items_created).toBe(0);
      expect(res.body.error).toBeTruthy();
      expect(res.body.generation_id).toMatch(/^[0-9a-f-]{36}$/);
      const gens = await pool.query("SELECT status FROM generations");
      expect(gens.rows[0].status).toBe("failed");
    } finally {
      if (prevKey) process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace server test -- routes/generate`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement routes/generate.ts**

Write `server/src/routes/generate.ts`:

```ts
import { Router } from "express";
import { GenerateRequest } from "@nihongo/shared";
import { runVocabGeneration } from "../services/generate.js";

export const generateRouter = Router();

const TIMEOUT_MS = 60_000;

generateRouter.post("/", async (req, res) => {
  const parsed = GenerateRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", code: "BAD_BODY", issues: parsed.error.issues });
    return;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await runVocabGeneration({
      count: parsed.data.count,
      weakness_hint: parsed.data.weakness_hint,
      signal: ac.signal,
    });
    res.json({
      generation_id: r.generation_id,
      status: r.status,
      items_created: r.items_created,
      cost_usd: r.cost_usd,
      items: r.items,
    });
  } catch (err) {
    const generation_id = await fetchLatestFailedId();
    res.status(502).json({
      generation_id,
      status: "failed" as const,
      items_created: 0 as const,
      cost_usd: 0,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
});

import { pool } from "../db/pool.js";

async function fetchLatestFailedId(): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM generations WHERE status='failed' ORDER BY requested_at DESC LIMIT 1`,
  );
  return r.rows[0]?.id ?? "00000000-0000-0000-0000-000000000000";
}
```

> **Why fetchLatestFailedId:** the service's failure path writes the failed row, but doesn't return its id when it throws. Re-querying for the latest failed row gives us the id without changing the throw signature. Single-user app means there's no race.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace server test -- routes/generate`
Expected: PASS — 7 route tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/generate.ts server/src/routes/generate.test.ts
git commit -m "feat(server): POST /api/generate"
```

---

### Task 12: Add `routes/generations.ts`

**Files:**
- Create: `server/src/routes/generations.ts`
- Create: `server/src/routes/generations.test.ts`

- [ ] **Step 1: Write the failing test**

Write `server/src/routes/generations.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { generationsRouter } from "./generations.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/generations", generationsRouter));

async function insertRow(opts: { offsetSeconds: number; status?: string; cost?: number }) {
  await pool.query(
    `INSERT INTO generations
       (requested_at, skill, count_requested, count_inserted, weakness_hint,
        model, prompt, response, input_tokens, output_tokens, cost_usd, status)
     VALUES (now() - ($1::int * interval '1 second'), 'vocab', 10, 10, NULL,
             'claude-sonnet-4-6', '{"x":1}'::jsonb, '{"text":"raw"}'::jsonb, 100, 50, $2, $3)`,
    [opts.offsetSeconds, opts.cost ?? 0.01, opts.status ?? "success"],
  );
}

beforeEach(() => resetDb());

describe("GET /api/generations", () => {
  it("requires passcode", async () => {
    const res = await request(app).get("/api/generations");
    expect(res.status).toBe(401);
  });

  it("returns rows in requested_at DESC order", async () => {
    await insertRow({ offsetSeconds: 30, status: "success" });
    await insertRow({ offsetSeconds: 10, status: "partial" });
    await insertRow({ offsetSeconds: 20, status: "failed" });
    const res = await request(app).get("/api/generations").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.generations.map((g: { status: string }) => g.status))
      .toEqual(["partial", "failed", "success"]);
  });

  it("excludes prompt and response jsonb columns from the response", async () => {
    await insertRow({ offsetSeconds: 5 });
    const res = await request(app).get("/api/generations").set("X-Passcode", PASSCODE);
    const row = res.body.generations[0];
    expect(row).not.toHaveProperty("prompt");
    expect(row).not.toHaveProperty("response");
    // Sanity: it does include the summary fields.
    expect(row).toHaveProperty("id");
    expect(row).toHaveProperty("status");
    expect(row).toHaveProperty("cost_usd");
    expect(row).toHaveProperty("count_inserted");
  });

  it("honors ?limit=", async () => {
    for (let i = 0; i < 5; i++) await insertRow({ offsetSeconds: i });
    const res = await request(app).get("/api/generations?limit=2").set("X-Passcode", PASSCODE);
    expect(res.body.generations).toHaveLength(2);
  });

  it("honors ?offset=", async () => {
    for (let i = 0; i < 4; i++) await insertRow({ offsetSeconds: i });
    const res = await request(app).get("/api/generations?limit=2&offset=2").set("X-Passcode", PASSCODE);
    expect(res.body.generations).toHaveLength(2);
  });

  it("clamps limit to 50", async () => {
    for (let i = 0; i < 60; i++) await insertRow({ offsetSeconds: i });
    const res = await request(app).get("/api/generations?limit=999").set("X-Passcode", PASSCODE);
    expect(res.body.generations).toHaveLength(50);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace server test -- routes/generations`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement routes/generations.ts**

Write `server/src/routes/generations.ts`:

```ts
import { Router } from "express";
import { pool } from "../db/pool.js";

export const generationsRouter = Router();

generationsRouter.get("/", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 10), 1), 50);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const r = await pool.query(
    `SELECT id, requested_at, skill, count_requested, count_inserted,
            weakness_hint, cost_usd, status, error
       FROM generations
      ORDER BY requested_at DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  res.json({
    generations: r.rows.map((row) => ({
      id: row.id,
      requested_at: row.requested_at.toISOString(),
      skill: row.skill,
      count_requested: row.count_requested,
      count_inserted: row.count_inserted,
      weakness_hint: row.weakness_hint,
      cost_usd: Number(row.cost_usd),
      status: row.status,
      error: row.error,
    })),
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace server test -- routes/generations`
Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/generations.ts server/src/routes/generations.test.ts
git commit -m "feat(server): GET /api/generations"
```

---

### Task 13: Add `routes/settings.ts`

**Files:**
- Create: `server/src/routes/settings.ts`
- Create: `server/src/routes/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Write `server/src/routes/settings.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { settingsRouter } from "./settings.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/settings", settingsRouter));

let prev: string | undefined;

beforeEach(() => { prev = process.env.ANTHROPIC_API_KEY; });
afterEach(() => { if (prev) process.env.ANTHROPIC_API_KEY = prev; else delete process.env.ANTHROPIC_API_KEY; });

describe("GET /api/settings/status", () => {
  it("requires passcode", async () => {
    const res = await request(app).get("/api/settings/status");
    expect(res.status).toBe(401);
  });

  it("reports configured=true when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-something";
    const res = await request(app).get("/api/settings/status").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ai_key_configured: true });
  });

  it("reports configured=false when ANTHROPIC_API_KEY is empty/unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(app).get("/api/settings/status").set("X-Passcode", PASSCODE);
    expect(res.body).toEqual({ ai_key_configured: false });
  });

  it("reports configured=false when ANTHROPIC_API_KEY is whitespace", async () => {
    process.env.ANTHROPIC_API_KEY = "   ";
    const res = await request(app).get("/api/settings/status").set("X-Passcode", PASSCODE);
    expect(res.body).toEqual({ ai_key_configured: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace server test -- routes/settings`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement routes/settings.ts**

Write `server/src/routes/settings.ts`:

```ts
import { Router } from "express";

export const settingsRouter = Router();

settingsRouter.get("/status", (_req, res) => {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  res.json({ ai_key_configured: key.trim().length > 0 });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace server test -- routes/settings`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/settings.ts server/src/routes/settings.test.ts
git commit -m "feat(server): GET /api/settings/status"
```

---

### Task 14: Wire the new routers into `server/src/index.ts`

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add the new mounts**

Replace `server/src/index.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { env } from "./env.js";
import { passcodeMiddleware } from "./middleware/passcode.js";
import { authRouter } from "./routes/auth.js";
import { queueRouter } from "./routes/queue.js";
import { sessionsRouter } from "./routes/sessions.js";
import { reviewsRouter } from "./routes/reviews.js";
import { statsRouter } from "./routes/stats.js";
import { generateRouter } from "./routes/generate.js";
import { generationsRouter } from "./routes/generations.js";
import { settingsRouter } from "./routes/settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");

export function createApp() {
  const app = express();
  app.use(express.json());
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.use("/api", passcodeMiddleware(env.PASSCODE));
  app.use("/api/auth", authRouter);
  app.use("/api/queue", queueRouter);
  app.use("/api/sessions", sessionsRouter);
  app.use("/api/reviews", reviewsRouter);
  app.use("/api/stats", statsRouter);
  app.use("/api/generate", generateRouter);
  app.use("/api/generations", generationsRouter);
  app.use("/api/settings", settingsRouter);

  if (env.NODE_ENV === "production") {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`server listening on http://localhost:${env.PORT}`);
  });
}
```

- [ ] **Step 2: Run the full server test suite**

Run: `npm --workspace server test`
Expected: PASS — all existing + new tests green.

- [ ] **Step 3: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): mount generate, generations, and settings routers"
```

---

# Phase C: Client UX

### Task 15: Add api-hooks for the new endpoints

**Files:**
- Modify: `client/src/api-hooks.ts`

- [ ] **Step 1: Append new helpers**

Edit `client/src/api-hooks.ts` — replace the file:

```ts
import { api } from "./api";
import type {
  QueueResponse,
  StartSessionResponse,
  ReviewStateResponse,
  StreakResponse,
  ReviewResult,
  GenerateRequest,
  GenerateSuccess,
  GenerateFailure,
  GenerationsResponse,
  SettingsStatusResponse,
} from "@nihongo/shared";

export function fetchQueue(): Promise<QueueResponse> {
  return api<QueueResponse>("/api/queue");
}

export function fetchStreak(): Promise<StreakResponse> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return api<StreakResponse>(`/api/stats/streak?tz=${encodeURIComponent(tz)}`);
}

export function startSession(): Promise<StartSessionResponse> {
  return api<StartSessionResponse>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ skill_filter: "vocab" }),
  });
}

export function endSession(id: string): Promise<{ ok: true }> {
  return api(`/api/sessions/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ ended_at: new Date().toISOString() }),
  });
}

export function submitReview(input: {
  item_id: string;
  result: ReviewResult;
  reviewed_at: string;
  session_id?: string;
}): Promise<ReviewStateResponse> {
  return api<ReviewStateResponse>("/api/reviews", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function generateItems(input: GenerateRequest): Promise<GenerateSuccess | GenerateFailure> {
  return api<GenerateSuccess | GenerateFailure>("/api/generate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchGenerations(limit = 10): Promise<GenerationsResponse> {
  return api<GenerationsResponse>(`/api/generations?limit=${limit}`);
}

export function fetchSettingsStatus(): Promise<SettingsStatusResponse> {
  return api<SettingsStatusResponse>("/api/settings/status");
}
```

> **Note:** `api()` throws `ApiError` for non-2xx, so `generateItems` only resolves on a 200 (success/partial). The 502 failure path is caught by the caller and surfaced as the failure UI.

- [ ] **Step 2: Verify the client builds**

Run: `npm --workspace client run build`
Expected: PASS — no TS errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/api-hooks.ts
git commit -m "feat(client): api hooks for generate, generations, settings status"
```

---

### Task 16: Build `<GenerateForm>` component

**Files:**
- Create: `client/src/components/GenerateForm.tsx`

- [ ] **Step 1: Implement the component**

Write `client/src/components/GenerateForm.tsx`:

```tsx
import { useState } from "react";
import { generateItems } from "../api-hooks";
import { ApiError } from "../api";

type Mode = "full" | "compact";
type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; inserted: number; requested: number; cost_usd: number }
  | { kind: "failed"; message: string };

type Props = {
  mode: Mode;
  defaultCount?: number;
  onSuccess?: () => void;
};

export function GenerateForm({ mode, defaultCount = 10, onSuccess }: Props) {
  const [count, setCount] = useState(defaultCount);
  const [hint, setHint] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const estimatedCents = Math.max(1, Math.ceil(count * 0.001 * 100));
  const estimateLabel = `~$0.${estimatedCents.toString().padStart(2, "0")}`;
  const buttonLabel = status.kind === "submitting"
    ? "Generating…"
    : `Generate ${count} vocab (${estimateLabel})`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "submitting" });
    try {
      const r = await generateItems({
        skill: "vocab",
        count,
        weakness_hint: mode === "full" && hint.trim() ? hint.trim() : undefined,
      });
      if (r.status === "failed") {
        setStatus({ kind: "failed", message: "error" in r ? r.error : "generation failed" });
        return;
      }
      setStatus({ kind: "success", inserted: r.items_created, requested: count, cost_usd: r.cost_usd });
      onSuccess?.();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "request failed";
      setStatus({ kind: "failed", message });
    }
  }

  const submitting = status.kind === "submitting";

  return (
    <form className={`generate-form generate-form--${mode}`} onSubmit={submit}>
      {mode === "full" && <h2>Generate vocab</h2>}

      <label className="generate-form__count">
        <span>Count</span>
        <input
          type="number"
          min={1}
          max={50}
          value={count}
          onChange={(e) => setCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
          disabled={submitting}
        />
      </label>

      {mode === "full" && (
        <label className="generate-form__hint">
          <span>Focus area (optional)</span>
          <textarea
            placeholder="e.g., verbs for cooking"
            maxLength={200}
            rows={2}
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            disabled={submitting}
          />
        </label>
      )}

      <button type="submit" disabled={submitting}>
        {buttonLabel}
      </button>

      {status.kind === "success" && (
        <p role="status" className="generate-form__status">
          {status.inserted < status.requested
            ? `Added ${status.inserted} of ${status.requested} cards · $${status.cost_usd.toFixed(2)}`
            : `Added ${status.inserted} cards · $${status.cost_usd.toFixed(2)}`}
        </p>
      )}
      {status.kind === "failed" && (
        <p role="alert" className="generate-form__status generate-form__status--error">
          Generation failed — try again
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `npm --workspace client run build`
Expected: PASS — no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/GenerateForm.tsx
git commit -m "feat(client): GenerateForm component (full + compact modes)"
```

---

### Task 17: Build the `SettingsScreen`

**Files:**
- Create: `client/src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Implement the screen**

Write `client/src/screens/SettingsScreen.tsx`:

```tsx
import { useEffect, useState } from "react";
import { auth } from "../auth";
import { fetchGenerations, fetchSettingsStatus } from "../api-hooks";
import { GenerateForm } from "../components/GenerateForm";
import type { GenerationSummary } from "@nihongo/shared";

type Props = {
  onSignOut: () => void;
  onBack: () => void;
};

export function SettingsScreen({ onSignOut, onBack }: Props) {
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [generations, setGenerations] = useState<GenerationSummary[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSettingsStatus(), fetchGenerations(10)])
      .then(([status, gens]) => {
        if (cancelled) return;
        setKeyConfigured(status.ai_key_configured);
        setGenerations(gens.generations);
      })
      .catch(() => {
        if (cancelled) return;
        setKeyConfigured(false);
      });
    return () => { cancelled = true; };
  }, [refreshTick]);

  function signOut() {
    auth.clear();
    onSignOut();
  }

  return (
    <main className="screen settings-screen">
      <header className="topbar">
        <button onClick={onBack} className="link" aria-label="Back to Today">← Today</button>
        <h1>Settings</h1>
      </header>

      <section className="settings-section">
        <h2>AI key</h2>
        {keyConfigured === null ? (
          <p className="muted">Checking…</p>
        ) : keyConfigured ? (
          <p className="pill pill--ok">✓ Configured (set via .env)</p>
        ) : (
          <p className="pill pill--err">✗ Not configured</p>
        )}
      </section>

      <section className="settings-section">
        <GenerateForm mode="full" onSuccess={() => setRefreshTick((n) => n + 1)} />
      </section>

      <section className="settings-section">
        <h2>Recent generations</h2>
        {generations.length === 0 ? (
          <p className="muted">No generations yet.</p>
        ) : (
          <ul className="generations-list">
            {generations.map((g) => (
              <li key={g.id}>
                <span>{formatTimestamp(g.requested_at)}</span>
                <span>{g.count_inserted} cards</span>
                <span>${g.cost_usd.toFixed(2)}</span>
                <span aria-label={g.status}>
                  {g.status === "failed" ? "✗ failed" : g.status === "partial" ? "◐ partial" : "✓"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="settings-section">
        <button type="button" className="link" onClick={signOut}>Sign out</button>
      </section>
    </main>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `npm --workspace client run build`
Expected: PASS — no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/screens/SettingsScreen.tsx
git commit -m "feat(client): SettingsScreen with key status, generate form, and history"
```

---

### Task 18: Wire Settings into App + Today header

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/screens/TodayScreen.tsx`

- [ ] **Step 1: Update App.tsx to support a "settings" tab**

Replace `client/src/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import { auth } from "./auth";
import { api } from "./api";
import { PasscodeScreen } from "./screens/PasscodeScreen";
import { TodayScreen } from "./screens/TodayScreen";
import { PracticeScreen } from "./screens/PracticeScreen";
import { BrowseScreen } from "./screens/BrowseScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { BottomTabs, type Tab } from "./components/BottomTabs";

type AuthState = "checking" | "needs-auth" | "authed";
type Route = Tab | "settings";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [route, setRoute] = useState<Route>("today");

  useEffect(() => {
    if (!auth.get()) { setAuthState("needs-auth"); return; }
    api("/api/auth/check", { method: "POST", body: "{}" })
      .then(() => setAuthState("authed"))
      .catch(() => setAuthState("needs-auth"));
  }, []);

  if (authState === "checking") return <main className="screen screen--centered">Loading…</main>;
  if (authState === "needs-auth") return <PasscodeScreen onAuthed={() => setAuthState("authed")} />;

  let active;
  if (route === "today") {
    active = (
      <TodayScreen
        onStartReview={() => setRoute("practice")}
        onOpenSettings={() => setRoute("settings")}
      />
    );
  } else if (route === "practice") {
    active = <PracticeScreen onDone={() => setRoute("today")} />;
  } else if (route === "browse") {
    active = <BrowseScreen />;
  } else if (route === "stats") {
    active = <StatsScreen />;
  } else {
    active = (
      <SettingsScreen
        onSignOut={() => setAuthState("needs-auth")}
        onBack={() => setRoute("today")}
      />
    );
  }

  const tab: Tab = route === "settings" ? "today" : route;

  return (
    <div className="app">
      {active}
      <BottomTabs active={tab} onChange={(t) => setRoute(t)} />
    </div>
  );
}
```

- [ ] **Step 2: Update TodayScreen to show Settings link instead of Sign out, and add empty-state form**

Replace `client/src/screens/TodayScreen.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { fetchQueue, fetchStreak } from "../api-hooks";
import { GenerateForm } from "../components/GenerateForm";

type Props = {
  onStartReview: () => void;
  onOpenSettings: () => void;
};

type State = {
  loading: boolean;
  due: number;
  newCount: number;
  streak: number;
  error: string | null;
};

export function TodayScreen({ onStartReview, onOpenSettings }: Props) {
  const [s, setS] = useState<State>({ loading: true, due: 0, newCount: 0, streak: 0, error: null });

  const load = useCallback(() => {
    Promise.all([fetchQueue(), fetchStreak()])
      .then(([queue, streak]) => {
        setS({
          loading: false,
          due: queue.due.length,
          newCount: queue.new.length,
          streak: streak.days,
          error: null,
        });
      })
      .catch((err) => {
        setS((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : "load failed" }));
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalReady = s.due + s.newCount;

  return (
    <main className="screen">
      <header className="topbar">
        <h1>Today</h1>
        <button onClick={onOpenSettings} className="link">Settings</button>
      </header>

      {s.loading ? (
        <section className="hero"><p>Loading…</p></section>
      ) : s.error ? (
        <section className="hero"><p role="alert">Couldn't load: {s.error}</p></section>
      ) : (
        <>
          <section className="hero">
            <p className="big-number">{totalReady}</p>
            <p>cards ready</p>
            <p className="muted">
              {s.due} due · {s.newCount} new · {s.streak}-day streak
            </p>
          </section>

          {totalReady > 0 ? (
            <button type="button" className="cta" onClick={onStartReview}>
              Start review
            </button>
          ) : (
            <section className="empty-state">
              <p className="center">✓ All caught up</p>
              <GenerateForm mode="compact" onSuccess={load} />
            </section>
          )}
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Verify TS compiles**

Run: `npm --workspace client run build`
Expected: PASS — no errors.

- [ ] **Step 4: Manual UI smoke**

Run dev servers: `npm run dev`
- Open http://localhost:5173 and log in.
- On Today, click "Settings" — verify the Settings screen renders with three sections + "← Today" back link.
- Click ← Today — back on Today screen.
- (Can't yet generate without a real API call; deferred to Task 22.)

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx client/src/screens/TodayScreen.tsx
git commit -m "feat(client): wire Settings route + empty-state generate form"
```

---

# Phase D: E2E + dev workflow

### Task 19: Add e2e empty fixture + helper

**Files:**
- Create: `e2e/tests/fixtures/seed-test-empty.sql`
- Create: `e2e/tests/fixtures.ts`

- [ ] **Step 1: Create the empty fixture**

Write `e2e/tests/fixtures/seed-test-empty.sql`:

```sql
TRUNCATE TABLE reviews, review_state, items, sessions, generations RESTART IDENTITY CASCADE;
```

- [ ] **Step 2: Create the loader helper**

Write `e2e/tests/fixtures.ts`:

```ts
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadFixture(name: "seed-test-items" | "seed-test-empty"): void {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL required");
  const file = path.join(__dirname, "fixtures", `${name}.sql`);
  execSync(`psql "${dbUrl}" -f "${file}"`, { stdio: "inherit" });
}
```

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/fixtures/seed-test-empty.sql e2e/tests/fixtures.ts
git commit -m "test(e2e): add empty fixture + loader helper"
```

---

### Task 20: Add `dev:e2e` script + e2e generate spec

**Files:**
- Modify: `package.json` (root)
- Create: `e2e/tests/generate.spec.ts`

- [ ] **Step 1: Add dev:e2e script to root package.json**

Edit `package.json` — add the script:

```json
{
  "scripts": {
    "dev": "npm --workspace server run dev & npm --workspace client run dev",
    "dev:e2e": "NIHONGO_FAKE_AI=1 npm --workspace server run dev & npm --workspace client run dev",
    "build": "npm --workspace shared run build && npm --workspace server run build && npm --workspace client run build",
    "test": "npm --workspace shared test --if-present && npm --workspace gen test && npm --workspace seed test && npm --workspace server test",
    "e2e": "npm --workspace e2e test",
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down",
    "db:migrate": "npm --workspace server run db:migrate"
  }
}
```

- [ ] **Step 2: Write the e2e spec**

Write `e2e/tests/generate.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";

const PASSCODE = process.env.E2E_PASSCODE ?? "test";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Passcode").fill(PASSCODE);
  await page.getByRole("button", { name: /enter/i }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

test("empty Today → compact generate form → cards appear", async ({ page }) => {
  await login(page);

  // Empty state visible.
  await expect(page.getByText(/All caught up/i)).toBeVisible();
  await expect(page.locator(".big-number")).toContainText("0");

  // Compact form: set count to 3 and submit.
  await page.locator("input[type=number]").fill("3");
  await page.getByRole("button", { name: /Generate 3 vocab/ }).click();

  // Success status.
  await expect(page.getByRole("status")).toContainText(/Added 3/);

  // Today re-fetches and shows 3 cards ready.
  await expect(page.locator(".big-number")).toContainText("3");

  // Start review and answer first card.
  await page.getByRole("button", { name: /start review/i }).click();
  await page.getByRole("button", { name: /tap to reveal/i }).click();
  await page.getByRole("button", { name: /got it/i }).click();
  await expect(page.locator(".practice__progress, h1:has-text('Done')")).toBeVisible();
});

test("settings screen lists the run after generation", async ({ page }) => {
  await login(page);

  // Generate 2 from compact form.
  await expect(page.getByText(/All caught up/i)).toBeVisible();
  await page.locator("input[type=number]").fill("2");
  await page.getByRole("button", { name: /Generate 2 vocab/ }).click();
  await expect(page.getByRole("status")).toContainText(/Added 2/);

  // Open Settings and verify a single row appears in Recent generations.
  await page.getByRole("button", { name: /Settings/ }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const rows = page.locator(".generations-list li");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("2 cards");
});
```

- [ ] **Step 3: Run the e2e suite**

In one terminal:

```bash
npm run dev:e2e
```

In another terminal (after dev server is ready):

```bash
npm run e2e
```

Expected: all e2e tests pass — both new generate.spec.ts cases plus existing smoke.spec.ts cases.

> **Note:** smoke.spec.ts currently relies on `seed-test-items.sql` being loaded once at global-setup. It still is. The new spec re-loads the empty fixture in its own `beforeEach`. That's idempotent — re-running smoke after generate.spec leaves seed items absent, but smoke.spec.ts's first action is to `loadFixture` via the global setup which seeds items at suite start. If smoke runs after generate, seed-test-items isn't reloaded automatically. To stay safe, also call `loadFixture("seed-test-items")` in smoke.spec.ts's `beforeEach`.

- [ ] **Step 4: Update smoke.spec.ts to also load its fixture per-test**

Edit `e2e/tests/smoke.spec.ts` — add at the top (after the import line) and a beforeEach hook:

```ts
import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";

const PASSCODE = process.env.E2E_PASSCODE ?? "test";

test.beforeEach(() => {
  loadFixture("seed-test-items");
});
```

(Leave the rest of the file unchanged.)

- [ ] **Step 5: Re-run e2e to confirm clean across both files**

Run: `npm run e2e`
Expected: PASS — all specs green.

- [ ] **Step 6: Commit**

```bash
git add package.json e2e/tests/generate.spec.ts e2e/tests/smoke.spec.ts
git commit -m "test(e2e): cover empty-state generation flow"
```

---

### Task 21: Manual smoke against real Anthropic key

**Files:** none

This task is a human verification. No code changes.

- [ ] **Step 1: Confirm `.env` has a real `ANTHROPIC_API_KEY`**

Run: `grep ANTHROPIC_API_KEY .env`
Expected: a non-empty value.

- [ ] **Step 2: Reset DB to a clean Phase 1.5 state**

Run:

```bash
psql "$DATABASE_URL" -c "TRUNCATE TABLE reviews, review_state, items, sessions, generations RESTART IDENTITY CASCADE;"
```

- [ ] **Step 3: Start the dev server WITHOUT NIHONGO_FAKE_AI**

Run: `npm run dev`

- [ ] **Step 4: Walk through the flow**

In a browser:
1. Log in with the real passcode.
2. Today shows "All caught up" + compact form.
3. Set count=3, click Generate.
4. Verify status reads `Added 3 cards · $0.0X` (some non-zero cost).
5. Verify big-number updates to 3.
6. Click "Start review", tap to reveal, click "Got it" — card advances.
7. Click Settings link in the Today header.
8. Verify AI key pill says "✓ Configured".
9. Verify "Recent generations" shows one row with `3 cards`, `$0.0X`, `✓`.
10. In the "Generate vocab" section, fill `Focus area: animals`, count=2, click Generate. Wait. Verify success.
11. Settings list now shows two rows.

- [ ] **Step 5: Verify DB rows directly**

Run:

```bash
psql "$DATABASE_URL" -c "SELECT count_requested, count_inserted, weakness_hint, cost_usd, status FROM generations ORDER BY requested_at DESC LIMIT 5;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM items WHERE source='ai';"
```

Expected: two rows in `generations`, `count(*) = 5` items.

- [ ] **Step 6: Check failure path**

Run: `ANTHROPIC_API_KEY="" npm --workspace server run dev` (in a separate terminal, killing the previous server first).
- Reload the app.
- Settings shows "✗ Not configured".
- Try to generate — verify the failure UI ("Generation failed — try again").
- DB: `SELECT status, error FROM generations ORDER BY requested_at DESC LIMIT 1;` shows `failed` with a non-null error.

- [ ] **Step 7: No commit needed.**

---

## Self-review checklist (run before declaring the plan ready)

- [x] **Spec coverage**: every spec section has a corresponding task.
  - `generations` table → Task 8.
  - `POST /api/generate` → Task 11.
  - `GET /api/generations` → Task 12.
  - `GET /api/settings/status` → Task 13.
  - `<GenerateForm>` two modes → Task 16.
  - Settings screen with four sections → Task 17.
  - Today empty state with compact form → Task 18.
  - Settings link replacing Sign-out in Today header → Task 18.
  - `gen/` package extraction → Tasks 1–7.
  - `pricing.ts` single source of truth → Task 2 + reused in Task 7 (seed) and Task 10 (server).
  - 60-second timeout on `/api/generate` → Task 11.
  - kuromoji singleton lazy load → preserved in Task 5.
  - NIHONGO_FAKE_AI hook → Task 6.
  - E2E empty-state spec → Task 20.
  - All `parse.test.ts`, `prompt.test.ts`, `furigana.test.ts`, `pricing.test.ts`, `generate.test.ts` covered in Tasks 2–6.
  - Server tests for happy/partial/failed/validation → Task 10 (service) + Task 11 (route).

- [x] **Type consistency**: `GenerateRequest`, `GenerateSuccess`, `GenerateFailure`, `GenerationsResponse`, `SettingsStatusResponse` defined in Task 9 are the same names used in Task 15 (api-hooks) and consumed in Tasks 16–18.

- [x] **No placeholders**: every code step contains the actual code.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-phase-1-5-ai-topup.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
