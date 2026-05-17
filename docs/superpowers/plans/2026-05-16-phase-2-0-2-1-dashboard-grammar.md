# Phase 2.0 + 2.1 — Dashboard + Grammar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace TodayScreen with a per-skill DashboardScreen, generalize `/api/generate` to all five skills, and ship the Grammar skill end-to-end (gen prompt/parser, FlipCard variant, e2e coverage).

**Architecture:** The data layer is already skill-agnostic (Phase 1). We add (1) per-skill prompt/parse/generate functions in `@nihongo/gen`, (2) a `runGeneration({skill,...})` dispatcher that replaces `runVocabGeneration`, (3) a new `/api/dashboard` aggregator endpoint, (4) a `DashboardScreen` with one card per skill, and (5) a Grammar variant of `<FlipCard>`. The other three skills (reading/conjugation/particle) follow in 2.2–2.4 using the same scaffolding.

**Tech Stack:** TypeScript, Express, pg, zod, Anthropic SDK, kuromoji, React, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-05-16-phase-2-multi-skill-design.md`](../specs/2026-05-16-phase-2-multi-skill-design.md)

---

## File map

**Modified workspaces**
- `shared/src/types.ts` — generalize `GenerateRequest.skill` to all 5 values; add `GrammarPrompt`, `GrammarAnswer`, `DashboardResponse`, `StatsBySkillResponse`
- `gen/src/prompt.ts` — add `buildGrammarPrompt`
- `gen/src/parse.ts` — add `parseGrammarBatch` + `GrammarItem` type
- `gen/src/generate.ts` — add `generateGrammarBatch`; replace `FAKE_FIXTURE` constant with `FAKE_FIXTURES: Record<Skill, ...>`; export skill-keyed lookup
- `gen/src/index.ts` — re-export new symbols
- `server/src/services/generate.ts` — replace `runVocabGeneration` with `runGeneration({skill, ...})` dispatcher
- `server/src/services/generate.test.ts` — update for new entry point + add grammar test case
- `server/src/routes/generate.ts` — uses generalized `GenerateRequest`
- `server/src/routes/generate.test.ts` — add grammar happy-path test
- `server/src/routes/stats.ts` — add `/by-skill` handler
- `server/src/routes/stats.test.ts` — add by-skill tests
- `server/src/index.ts` — mount `dashboardRouter`

**New files**
- `server/src/routes/dashboard.ts` — `GET /api/dashboard` aggregator
- `server/src/routes/dashboard.test.ts`
- `client/src/screens/DashboardScreen.tsx`
- `client/src/components/SkillCard.tsx` — single skill cell on the dashboard
- `client/src/styles/dashboard.css`
- `e2e/tests/grammar.spec.ts`

**Modified client files**
- `client/src/App.tsx` — route `today` now renders `DashboardScreen`
- `client/src/api-hooks.ts` — `fetchDashboard`, `fetchStatsBySkill`; `generateItems` accepts any `Skill`
- `client/src/components/BottomTabs.tsx` — first tab label can stay "Today"
- `client/src/components/FlipCard.tsx` — accepts `variant: "vocab" | "grammar"` prop; renders pattern chip when grammar
- `client/src/components/GenerateForm.tsx` — adds skill picker prop (`defaultSkill`, `allowedSkills`)
- `client/src/screens/PracticeScreen.tsx` — passes the item's skill into the card; dispatches by skill (today only vocab + grammar via FlipCard; future skills extend the switch)
- `client/src/screens/SettingsScreen.tsx` — full GenerateForm exposes all 5 skills
- `client/src/screens/StatsScreen.tsx` — renders per-skill blocks from `/api/stats/by-skill`
- `client/src/screens/TodayScreen.tsx` — DELETED (DashboardScreen replaces it)
- `client/src/main.tsx` — import `./styles/dashboard.css`

**Modified e2e**
- `e2e/tests/smoke.spec.ts` — dashboard's "All due across skills" card replaces the old hero. Assertions update.
- `e2e/tests/generate.spec.ts` — empty state moved into the per-skill SkillCard. Selectors update.

---

# Phase 2.0+2.1 tasks

### Task 1: Generalize shared schemas

**Files:**
- Modify: `shared/src/types.ts`

- [ ] **Step 1: Generalize `GenerateRequest.skill` and add new schemas**

Edit `shared/src/types.ts` — find `GenerateRequest` and replace, then append the new schemas. Locate the existing block:

```ts
export const GenerateRequest = z.object({
  skill: z.literal("vocab"),
  count: z.number().int().min(1).max(50),
  weakness_hint: z.string().max(200).optional(),
});
```

Replace with:

```ts
export const GenerateRequest = z.object({
  skill: Skill,                                       // all 5 values
  count: z.number().int().min(1).max(50),
  weakness_hint: z.string().max(200).optional(),
});
```

Then APPEND at the bottom of the file:

```ts
// ----- Per-skill prompt/answer shapes (parent spec) -----

export const GrammarPrompt = z.object({
  sentence_ruby: z.string(),
  pattern: z.string(),
  sentence_english: z.string(),
});
export type GrammarPrompt = z.infer<typeof GrammarPrompt>;

export const GrammarAnswer = z.object({
  explanation: z.string(),
  another_example_ruby: z.string().optional(),
});
export type GrammarAnswer = z.infer<typeof GrammarAnswer>;

// ----- API: dashboard -----

export const SkillCounts = z.object({
  due: z.number().int().nonnegative(),
  new: z.number().int().nonnegative(),
});
export type SkillCounts = z.infer<typeof SkillCounts>;

export const DashboardResponse = z.object({
  streak_days: z.number().int().nonnegative(),
  last_practiced_at: z.string().nullable(),
  by_skill: z.object({
    vocab: SkillCounts,
    grammar: SkillCounts,
    reading: SkillCounts,
    conjugation: SkillCounts,
    particle: SkillCounts,
  }),
});
export type DashboardResponse = z.infer<typeof DashboardResponse>;

// ----- API: stats/by-skill -----

export const SkillStats = z.object({
  box_counts: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative()]),
  accuracy_30d: z.number().min(0).max(1).nullable(),  // null if no reviews
});
export type SkillStats = z.infer<typeof SkillStats>;

export const StatsBySkillResponse = z.object({
  by_skill: z.object({
    vocab: SkillStats,
    grammar: SkillStats,
    reading: SkillStats,
    conjugation: SkillStats,
    particle: SkillStats,
  }),
});
export type StatsBySkillResponse = z.infer<typeof StatsBySkillResponse>;
```

- [ ] **Step 2: Update the existing ItemRecord's `prompt`/`answer` typing**

Currently `ItemRecord.prompt = VocabPrompt`, `answer = VocabAnswer` — Phase 1 limited it to vocab. To support multi-skill items, change to a permissive union. Find:

```ts
export const ItemRecord = z.object({
  id: z.string().uuid(),
  skill: Skill,
  prompt: VocabPrompt,           // Phase 1: vocab only
  answer: VocabAnswer,
  ...
```

Replace `prompt: VocabPrompt` and `answer: VocabAnswer` with `prompt: z.unknown()` and `answer: z.unknown()`:

```ts
export const ItemRecord = z.object({
  id: z.string().uuid(),
  skill: Skill,
  prompt: z.unknown(),
  answer: z.unknown(),
  source: Source,
  external_id: z.string().nullable().optional(),
  tags: z.array(z.string()),
  created_at: z.string(),
});
```

This is a backward-compatible widening — client narrows per skill at render time.

- [ ] **Step 3: Verify shared build**

Run: `npm --workspace shared run build`
Expected: PASS.

- [ ] **Step 4: Run all dependent tests**

Run: `set -a; source .env; set +a; npm test`
Expected: all 95 prior tests still pass (the route tests don't depend on `prompt`/`answer` shape).

- [ ] **Step 5: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat(shared): generalize GenerateRequest + add Dashboard / StatsBySkill / GrammarPrompt schemas"
```

---

### Task 2: Add grammar prompt builder

**Files:**
- Modify: `gen/src/prompt.ts`
- Modify: `gen/src/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `gen/src/prompt.test.ts`:

```ts
import { buildGrammarPrompt } from "./prompt.js";

describe("buildGrammarPrompt", () => {
  it("asks for the requested count and returns strict JSON instructions", () => {
    const { system, user } = buildGrammarPrompt({ count: 4 });
    expect(system).toMatch(/JSON/i);
    expect(system).toContain('"items"');
    expect(system).toContain('"pattern"');
    expect(system).toContain('"sentence_japanese"');
    expect(system).toContain('"sentence_english"');
    expect(system).toContain('"explanation"');
    expect(user).toContain("4");
  });

  it("includes the weakness hint when provided", () => {
    const { user } = buildGrammarPrompt({ count: 2, weakness_hint: "te-form connectives" });
    expect(user).toContain("te-form connectives");
  });
});
```

(Add to the existing imports at the top of the file: change `import { buildVocabPrompt, buildSentencesForCardsPrompt } from "./prompt.js";` to also import `buildGrammarPrompt` — or merge into one import line.)

- [ ] **Step 2: Run to see failure**

Run: `npm --workspace gen test -- prompt`
Expected: FAIL — `buildGrammarPrompt is not a function`.

- [ ] **Step 3: Implement**

Append to `gen/src/prompt.ts`:

```ts
const GRAMMAR_SYSTEM = `You generate Japanese grammar drill cards for an intermediate learner. Each card shows a natural sentence built around a specific pattern. Vary patterns across the batch.
Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "items": [ { "pattern": "<pattern label, e.g. 〜ながら>", "sentence_japanese": "<JA>", "sentence_english": "<EN>", "explanation": "<1–2 sentence explanation>", "another_example_japanese": "<optional second example, JA>" } ] }`;

export function buildGrammarPrompt(args: { count: number; weakness_hint?: string }): PromptPair {
  const lines: string[] = [`Generate ${args.count} grammar drill cards.`];
  if (args.weakness_hint && args.weakness_hint.trim().length > 0) {
    lines.push(`Focus on: ${args.weakness_hint.trim()}`);
  }
  return { system: GRAMMAR_SYSTEM, user: lines.join("\n") };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm --workspace gen test`
Expected: PASS — 31 total tests green (29 prior + 2 new).

- [ ] **Step 5: Commit**

```bash
git add gen/src/prompt.ts gen/src/prompt.test.ts
git commit -m "feat(gen): grammar prompt builder"
```

---

### Task 3: Add grammar parser

**Files:**
- Modify: `gen/src/parse.ts`
- Modify: `gen/src/parse.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `gen/src/parse.test.ts`:

```ts
import { parseGrammarBatch } from "./parse.js";

describe("parseGrammarBatch", () => {
  it("returns items with pattern/sentence_japanese/sentence_english/explanation", () => {
    const raw = JSON.stringify({
      items: [
        {
          pattern: "〜ながら",
          sentence_japanese: "音楽を聞きながら勉強します。",
          sentence_english: "I study while listening to music.",
          explanation: "〜ながら attaches to the masu-stem and means 'while doing X'.",
        },
      ],
    });
    expect(parseGrammarBatch(raw)).toEqual([
      {
        pattern: "〜ながら",
        sentence_japanese: "音楽を聞きながら勉強します。",
        sentence_english: "I study while listening to music.",
        explanation: "〜ながら attaches to the masu-stem and means 'while doing X'.",
      },
    ]);
  });

  it("accepts an optional another_example_japanese field", () => {
    const raw = JSON.stringify({
      items: [
        {
          pattern: "〜ながら",
          sentence_japanese: "歩きながら話す。",
          sentence_english: "Talk while walking.",
          explanation: "...",
          another_example_japanese: "食べながら見る。",
        },
      ],
    });
    const out = parseGrammarBatch(raw);
    expect(out[0]!.another_example_japanese).toBe("食べながら見る。");
  });

  it("throws when a required field is missing", () => {
    expect(() => parseGrammarBatch(JSON.stringify({
      items: [{ pattern: "x", sentence_japanese: "y" }],
    }))).toThrow();
  });

  it("throws when items is not an array", () => {
    expect(() => parseGrammarBatch(JSON.stringify({ items: "x" }))).toThrow();
  });

  it("strips ```json fences", () => {
    const inner = JSON.stringify({
      items: [{ pattern: "x", sentence_japanese: "y", sentence_english: "z", explanation: "w" }],
    });
    expect(parseGrammarBatch("```json\n" + inner + "\n```")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npm --workspace gen test -- parse`
Expected: FAIL — module export missing.

- [ ] **Step 3: Implement**

Append to `gen/src/parse.ts`:

```ts
export type GrammarItem = {
  pattern: string;
  sentence_japanese: string;
  sentence_english: string;
  explanation: string;
  another_example_japanese?: string;
};

export function parseGrammarBatch(raw: string): GrammarItem[] {
  const parsed = JSON.parse(stripFences(raw));
  const items = parsed?.items;
  if (!Array.isArray(items)) throw new Error("response missing 'items' array");
  for (const it of items) {
    if (
      typeof it?.pattern !== "string" ||
      typeof it?.sentence_japanese !== "string" ||
      typeof it?.sentence_english !== "string" ||
      typeof it?.explanation !== "string"
    ) {
      throw new Error("grammar item missing required fields");
    }
    if (it.another_example_japanese !== undefined && typeof it.another_example_japanese !== "string") {
      throw new Error("grammar item has non-string another_example_japanese");
    }
  }
  return items as GrammarItem[];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm --workspace gen test`
Expected: PASS — 36 total (31 + 5 new).

- [ ] **Step 5: Commit**

```bash
git add gen/src/parse.ts gen/src/parse.test.ts
git commit -m "feat(gen): grammar parser"
```

---

### Task 4: Add `generateGrammarBatch` + per-skill fake fixtures

**Files:**
- Modify: `gen/src/generate.ts`
- Modify: `gen/src/generate.test.ts`
- Modify: `gen/src/index.ts`

- [ ] **Step 1: Write failing tests**

Append to `gen/src/generate.test.ts`:

```ts
import { generateGrammarBatch } from "./generate.js";

describe("generateGrammarBatch", () => {
  it("calls the SDK with grammar system prompt and returns parsed items", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ items: [
        { pattern: "〜ながら", sentence_japanese: "歩きながら話す。", sentence_english: "Talk while walking.", explanation: "..." },
      ]})}],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const r = await generateGrammarBatch({ count: 1, client: { messages: { create } } as never });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.pattern).toBe("〜ながら");
    const arg = create.mock.calls[0]![0];
    expect(arg.system).toMatch(/grammar/i);
  });

  it("returns a deterministic fixture when NIHONGO_FAKE_AI=1", async () => {
    const prev = process.env.NIHONGO_FAKE_AI;
    process.env.NIHONGO_FAKE_AI = "1";
    try {
      const r = await generateGrammarBatch({ count: 2 });
      expect(r.items).toHaveLength(2);
      for (const it of r.items) {
        expect(typeof it.pattern).toBe("string");
        expect(it.pattern.length).toBeGreaterThan(0);
        expect(it.sentence_japanese.length).toBeGreaterThan(0);
        expect(it.explanation.length).toBeGreaterThan(0);
      }
      expect(r.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
    } finally {
      if (prev === undefined) delete process.env.NIHONGO_FAKE_AI;
      else process.env.NIHONGO_FAKE_AI = prev;
    }
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npm --workspace gen test`
Expected: FAIL — `generateGrammarBatch is not exported`.

- [ ] **Step 3: Refactor `FAKE_FIXTURE` to a per-skill map and add `generateGrammarBatch`**

Edit `gen/src/generate.ts`. Find the existing `FAKE_FIXTURE` constant + `generateVocabBatch` function and REPLACE the relevant block:

```ts
// Replace this block:
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
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<VocabItem[]>({
    system, user, parse: parseVocabBatch, client, signal: args.signal,
  });
  return { items: value, usage, raw };
}
```

WITH:

```ts
// Per-skill fake fixtures used when NIHONGO_FAKE_AI=1.
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
```

Also add the imports at the top of the file:

```ts
import { buildGrammarPrompt } from "./prompt.js";
import { parseGrammarBatch, type GrammarItem } from "./parse.js";
```

And add `GrammarItem` to the existing `export type { ... }` line near the top.

- [ ] **Step 4: Re-export from index**

Edit `gen/src/index.ts`:

```ts
export { computeCost, MODEL, INPUT_PER_MTOK, OUTPUT_PER_MTOK, type Usage } from "./pricing.js";
export { stripFences, parseVocabBatch, parseSentencesForCards, parseGrammarBatch, type VocabItem, type SentenceForCard, type GrammarItem } from "./parse.js";
export { buildVocabPrompt, buildSentencesForCardsPrompt, buildGrammarPrompt, type CardInput } from "./prompt.js";
export { toRubyHtml, readingFor, getTokenizer } from "./furigana.js";
export {
  generateVocabBatch,
  generateGrammarBatch,
  generateSentencesForCards,
  GenerateError,
} from "./generate.js";
```

- [ ] **Step 5: Run to verify pass**

Run: `npm --workspace gen test`
Expected: PASS — all gen tests green.

- [ ] **Step 6: Commit**

```bash
git add gen/src/generate.ts gen/src/generate.test.ts gen/src/index.ts
git commit -m "feat(gen): generateGrammarBatch + per-skill fake fixtures"
```

---

### Task 5: Refactor server `services/generate.ts` into `runGeneration` dispatcher

**Files:**
- Modify: `server/src/services/generate.ts`
- Modify: `server/src/services/generate.test.ts`

- [ ] **Step 1: Update failing tests first**

Open `server/src/services/generate.test.ts`. Replace ALL `runVocabGeneration(...)` calls with `runGeneration({skill: "vocab", ...})`. Also rename the test file's import:

```ts
import { runGeneration } from "./generate.js";
```

For each of the existing 4 tests, change:

```ts
const r = await runVocabGeneration({ count: 2, client });
```

to:

```ts
const r = await runGeneration({ skill: "vocab", count: 2, client });
```

(Same for the partial / failed / weakness_hint tests — add `skill: "vocab"` to each.)

Then append a new test at the end of the file:

```ts
function fakeGrammarClient(items: Array<{ pattern: string; sentence_japanese: string; sentence_english: string; explanation: string }>) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify({ items }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  };
}

describe("runGeneration grammar", () => {
  it("inserts grammar items with sentence_ruby + sentence_english, writes generations row", async () => {
    const client = fakeGrammarClient([
      { pattern: "〜ながら", sentence_japanese: "音楽を聞きながら勉強します。", sentence_english: "I study while listening to music.", explanation: "..." },
      { pattern: "〜たい", sentence_japanese: "寿司を食べたいです。", sentence_english: "I want to eat sushi.", explanation: "..." },
    ]);
    const r = await runGeneration({ skill: "grammar", count: 2, client });
    expect(r.status).toBe("success");
    expect(r.items_created).toBe(2);

    const items = await pool.query("SELECT skill, prompt, answer FROM items ORDER BY created_at");
    expect(items.rowCount).toBe(2);
    expect(items.rows[0].skill).toBe("grammar");
    expect(items.rows[0].prompt.sentence_ruby).toContain("<ruby>");
    expect(items.rows[0].prompt.pattern).toBe("〜ながら");
    expect(items.rows[0].answer.explanation).toBeTruthy();

    const gens = await pool.query("SELECT skill, status, count_inserted FROM generations");
    expect(gens.rows[0].skill).toBe("grammar");
    expect(gens.rows[0].status).toBe("success");
    expect(gens.rows[0].count_inserted).toBe(2);
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `set -a; source .env; set +a; npm --workspace server test -- services/generate`
Expected: FAIL — `runGeneration` doesn't exist; old `runVocabGeneration` removed.

- [ ] **Step 3: Rewrite `server/src/services/generate.ts`**

Replace the file with:

```ts
import { randomUUID } from "node:crypto";
import {
  generateVocabBatch,
  generateGrammarBatch,
  toRubyHtml,
  readingFor,
  computeCost,
  GenerateError,
  MODEL,
  type Usage,
  type VocabItem,
  type GrammarItem,
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
```

- [ ] **Step 4: Run to verify pass**

Run: `set -a; source .env; set +a; npm --workspace server test -- services/generate`
Expected: PASS — 5 tests now (4 prior renamed + 1 new grammar test).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/generate.ts server/src/services/generate.test.ts
git commit -m "refactor(server): runGeneration dispatcher (vocab + grammar)"
```

---

### Task 6: Update `routes/generate.ts` to use generalized schema

**Files:**
- Modify: `server/src/routes/generate.ts`
- Modify: `server/src/routes/generate.test.ts`

- [ ] **Step 1: Update the route**

Edit `server/src/routes/generate.ts` — find the `runVocabGeneration` call and replace:

```ts
const r = await runVocabGeneration({
  count: parsed.data.count,
  weakness_hint: parsed.data.weakness_hint,
  signal: ac.signal,
});
```

with:

```ts
const r = await runGeneration({
  skill: parsed.data.skill,
  count: parsed.data.count,
  weakness_hint: parsed.data.weakness_hint,
  signal: ac.signal,
});
```

Update the import accordingly:

```ts
import { runGeneration } from "../services/generate.js";
```

- [ ] **Step 2: Add a grammar success-path test**

Open `server/src/routes/generate.test.ts`. Append:

```ts
describe("POST /api/generate (grammar)", () => {
  it("inserts grammar items when skill=grammar", async () => {
    const res = await request(app)
      .post("/api/generate")
      .set("X-Passcode", PASSCODE)
      .send({ skill: "grammar", count: 2 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.items_created).toBe(2);

    const r = await pool.query("SELECT count(*)::int AS c FROM items WHERE skill='grammar' AND source='ai'");
    expect(r.rows[0].c).toBe(2);
  });
});
```

- [ ] **Step 3: Run to verify**

Run: `set -a; source .env; set +a; npm --workspace server test`
Expected: PASS — all server tests, including the new grammar route test.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/generate.ts server/src/routes/generate.test.ts
git commit -m "feat(server): /api/generate dispatches all skills via runGeneration"
```

---

### Task 7: Add `GET /api/dashboard`

**Files:**
- Create: `server/src/routes/dashboard.ts`
- Create: `server/src/routes/dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

Write `server/src/routes/dashboard.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { dashboardRouter } from "./dashboard.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/dashboard", dashboardRouter));

async function insertItem(skill: string, opts: { nextReviewMinutesAgo?: number; box?: number } = {}) {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ($1, '{}'::jsonb, '{}'::jsonb, 'seed', $2) RETURNING id`,
    [skill, `e-${Math.random()}`],
  );
  const id = r.rows[0].id;
  if (opts.box !== undefined) {
    const t = new Date(Date.now() - (opts.nextReviewMinutesAgo ?? 0) * 60_000);
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, total_reviews)
       VALUES ($1, $2, $3, 0)`,
      [id, opts.box, t.toISOString()],
    );
  }
  return id;
}

beforeEach(() => resetDb());

describe("GET /api/dashboard", () => {
  it("requires passcode", async () => {
    const res = await request(app).get("/api/dashboard");
    expect(res.status).toBe(401);
  });

  it("returns zero counts when no items exist", async () => {
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.streak_days).toBe(0);
    expect(res.body.last_practiced_at).toBeNull();
    for (const skill of ["vocab", "grammar", "reading", "conjugation", "particle"]) {
      expect(res.body.by_skill[skill]).toEqual({ due: 0, new: 0 });
    }
  });

  it("counts due + new items per skill", async () => {
    await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });   // due
    await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 60 });   // due
    await insertItem("vocab");                                          // new
    await insertItem("grammar", { box: 1, nextReviewMinutesAgo: 5 });  // due
    await insertItem("particle");                                       // new

    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.by_skill.vocab).toEqual({ due: 2, new: 1 });
    expect(res.body.by_skill.grammar).toEqual({ due: 1, new: 0 });
    expect(res.body.by_skill.particle).toEqual({ due: 0, new: 1 });
    expect(res.body.by_skill.reading).toEqual({ due: 0, new: 0 });
    expect(res.body.by_skill.conjugation).toEqual({ due: 0, new: 0 });
  });

  it("returns last_practiced_at as the most recent review", async () => {
    const id = await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 60 });
    const earlier = new Date(Date.now() - 120 * 60_000).toISOString();
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    await pool.query(
      `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after) VALUES ($1, $2, 'got_it', 1, 2), ($1, $3, 'got_it', 2, 3)`,
      [id, earlier, recent],
    );
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(new Date(res.body.last_practiced_at).getTime()).toBe(new Date(recent).getTime());
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `set -a; source .env; set +a; npm --workspace server test -- routes/dashboard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Write `server/src/routes/dashboard.ts`:

```ts
import { Router } from "express";
import { pool } from "../db/pool.js";
import { computeStreakDays } from "../services/streak.js";

const SKILLS = ["vocab", "grammar", "reading", "conjugation", "particle"] as const;
const NEW_CAP = 10;

export const dashboardRouter = Router();

dashboardRouter.get("/", async (_req, res) => {
  // Due counts per skill: items with review_state.next_review_at <= now().
  const dueRes = await pool.query<{ skill: string; c: string }>(
    `SELECT i.skill, count(*)::text AS c
       FROM items i JOIN review_state rs ON rs.item_id = i.id
      WHERE rs.next_review_at <= now()
      GROUP BY i.skill`,
  );
  const due = new Map(dueRes.rows.map((r) => [r.skill, Number(r.c)]));

  // New counts per skill: items with no review_state, capped at NEW_CAP per skill.
  const newRes = await pool.query<{ skill: string; c: string }>(
    `SELECT i.skill, LEAST(count(*), $1)::text AS c
       FROM items i LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE rs.item_id IS NULL
      GROUP BY i.skill`,
    [NEW_CAP],
  );
  const fresh = new Map(newRes.rows.map((r) => [r.skill, Number(r.c)]));

  // Last practice timestamp + streak.
  const lastRes = await pool.query<{ ts: Date | null }>(
    `SELECT max(reviewed_at) AS ts FROM reviews`,
  );
  const last = lastRes.rows[0]?.ts ?? null;

  // Streak: reuse existing services/streak.ts (tz-aware computeStreakDays).
  // For dashboard simplicity, omit tz here and use UTC; the Stats screen
  // still has the tz-aware endpoint. Owner is single-user — UTC drift is fine.
  const streakDays = await computeStreakDays(pool, "UTC");

  const by_skill: Record<string, { due: number; new: number }> = {};
  for (const s of SKILLS) {
    by_skill[s] = { due: due.get(s) ?? 0, new: fresh.get(s) ?? 0 };
  }

  res.json({
    streak_days: streakDays,
    last_practiced_at: last ? last.toISOString() : null,
    by_skill,
  });
});
```

Check that `services/streak.ts` exports `computeStreakDays(pool, tz)`. If the signature differs, adapt — look at how `routes/stats.ts` calls it.

- [ ] **Step 4: Run to verify**

Run: `set -a; source .env; set +a; npm --workspace server test -- routes/dashboard`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/dashboard.ts server/src/routes/dashboard.test.ts
git commit -m "feat(server): GET /api/dashboard aggregator"
```

---

### Task 8: Add `GET /api/stats/by-skill`

**Files:**
- Modify: `server/src/routes/stats.ts`
- Modify: `server/src/routes/stats.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/src/routes/stats.test.ts`:

```ts
describe("GET /api/stats/by-skill", () => {
  it("returns box_counts and accuracy per skill", async () => {
    // 3 vocab items: one in box 1, two in box 3. One missed review out of 5.
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await pool.query(
        `INSERT INTO items (skill, prompt, answer, source, external_id) VALUES ('vocab','{}','{}','seed',$1) RETURNING id`,
        [`s-${i}`],
      );
      ids.push(r.rows[0].id);
    }
    await pool.query(`INSERT INTO review_state (item_id, box, next_review_at) VALUES ($1, 1, now())`, [ids[0]]);
    await pool.query(`INSERT INTO review_state (item_id, box, next_review_at) VALUES ($1, 3, now()), ($2, 3, now())`, [ids[1], ids[2]]);
    // 5 reviews — 1 missed → accuracy 0.8
    for (let i = 0; i < 4; i++) {
      await pool.query(`INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after) VALUES ($1, now() - interval '1 hour' * $2, 'got_it', 1, 2)`, [ids[0], i]);
    }
    await pool.query(`INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after) VALUES ($1, now(), 'missed', 2, 1)`, [ids[0]]);

    const res = await request(app).get("/api/stats/by-skill").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.by_skill.vocab.box_counts).toEqual([1, 0, 2, 0, 0]);
    expect(res.body.by_skill.vocab.accuracy_30d).toBeCloseTo(0.8, 2);
    expect(res.body.by_skill.grammar.box_counts).toEqual([0, 0, 0, 0, 0]);
    expect(res.body.by_skill.grammar.accuracy_30d).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `set -a; source .env; set +a; npm --workspace server test -- routes/stats`
Expected: FAIL — endpoint doesn't exist (404).

- [ ] **Step 3: Implement**

Open `server/src/routes/stats.ts`. Add a new handler:

```ts
const SKILLS = ["vocab", "grammar", "reading", "conjugation", "particle"] as const;

statsRouter.get("/by-skill", async (_req, res) => {
  const boxRes = await pool.query<{ skill: string; box: number; c: string }>(
    `SELECT i.skill, rs.box, count(*)::text AS c
       FROM items i JOIN review_state rs ON rs.item_id = i.id
      GROUP BY i.skill, rs.box`,
  );
  const accRes = await pool.query<{ skill: string; total: string; missed: string }>(
    `SELECT i.skill,
            count(*)::text AS total,
            count(*) FILTER (WHERE r.result='missed')::text AS missed
       FROM reviews r JOIN items i ON i.id = r.item_id
      WHERE r.reviewed_at >= now() - interval '30 days'
      GROUP BY i.skill`,
  );
  const by_skill: Record<string, { box_counts: number[]; accuracy_30d: number | null }> = {};
  for (const s of SKILLS) {
    by_skill[s] = { box_counts: [0, 0, 0, 0, 0], accuracy_30d: null };
  }
  for (const row of boxRes.rows) {
    const target = by_skill[row.skill];
    if (target && row.box >= 1 && row.box <= 5) {
      target.box_counts[row.box - 1] = Number(row.c);
    }
  }
  for (const row of accRes.rows) {
    const total = Number(row.total);
    const missed = Number(row.missed);
    const target = by_skill[row.skill];
    if (target && total > 0) {
      target.accuracy_30d = (total - missed) / total;
    }
  }
  res.json({ by_skill });
});
```

(Add to the top of the file if not already imported: `import { pool } from "../db/pool.js";`)

- [ ] **Step 4: Run to verify**

Run: `set -a; source .env; set +a; npm --workspace server test -- routes/stats`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/stats.ts server/src/routes/stats.test.ts
git commit -m "feat(server): GET /api/stats/by-skill"
```

---

### Task 9: Wire `dashboardRouter` into `server/src/index.ts`

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add the import + mount**

Find the import block and add:

```ts
import { dashboardRouter } from "./routes/dashboard.js";
```

Find the route-mount block and add right after the `statsRouter` line:

```ts
app.use("/api/dashboard", dashboardRouter);
```

- [ ] **Step 2: Run full server tests + smoke-start**

```bash
set -a; source .env; set +a; npm --workspace server test
```
Expected: all tests pass.

```bash
set -a; source .env; set +a; (npm --workspace server start &); sleep 3; curl -s -H "X-Passcode: $PASSCODE" http://localhost:3001/api/dashboard | head -c 200; pkill -f "tsx src/index.ts" 2>/dev/null; true
```
Expected: JSON dashboard payload.

- [ ] **Step 3: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): mount /api/dashboard"
```

---

### Task 10: Client api-hooks update

**Files:**
- Modify: `client/src/api-hooks.ts`

- [ ] **Step 1: Add helpers + generalize `generateItems`**

Replace `client/src/api-hooks.ts`:

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
  GenerationsResponse,
  SettingsStatusResponse,
  DashboardResponse,
  StatsBySkillResponse,
  Skill,
} from "@nihongo/shared";

export function fetchQueue(skill?: Skill): Promise<QueueResponse> {
  const qs = skill ? `?skill=${encodeURIComponent(skill)}` : "";
  return api<QueueResponse>(`/api/queue${qs}`);
}

export function fetchStreak(): Promise<StreakResponse> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return api<StreakResponse>(`/api/stats/streak?tz=${encodeURIComponent(tz)}`);
}

export function fetchDashboard(): Promise<DashboardResponse> {
  return api<DashboardResponse>(`/api/dashboard`);
}

export function fetchStatsBySkill(): Promise<StatsBySkillResponse> {
  return api<StatsBySkillResponse>(`/api/stats/by-skill`);
}

export function startSession(skill?: Skill): Promise<StartSessionResponse> {
  return api<StartSessionResponse>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ skill_filter: skill ?? "vocab" }),
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

export function generateItems(input: GenerateRequest): Promise<GenerateSuccess> {
  return api<GenerateSuccess>("/api/generate", {
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

- [ ] **Step 2: Verify client build**

Run: `npm --workspace client run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/api-hooks.ts
git commit -m "feat(client): api hooks for dashboard, stats/by-skill, skill-aware queue/session"
```

---

### Task 11: Extend `FlipCard` with grammar variant

**Files:**
- Modify: `client/src/components/FlipCard.tsx`
- Modify: `client/src/styles/cards.css`

- [ ] **Step 1: Read current FlipCard to understand the existing structure**

Run: `head -80 /Users/michaelgalloway/dev/nihongo-practice/client/src/components/FlipCard.tsx`

Note what the current vocab-only render looks like. Then modify.

- [ ] **Step 2: Generalize FlipCard to accept variant + per-skill prompt/answer**

Replace the FlipCard component signature and body. The key change: instead of destructuring vocab-specific `target`/`meaning`, accept the whole `item.prompt` and `item.answer` and switch on `item.skill`. Render:

- **vocab**: unchanged — sentence_ruby, target highlighted, then meaning/reading on flip.
- **grammar**: sentence_ruby, **pattern chip** below the sentence, sentence_english always visible on prompt face. Flip reveals explanation + optional another_example_ruby.

Write `client/src/components/FlipCard.tsx`:

```tsx
import { useState } from "react";
import type { ItemRecord, VocabPrompt, VocabAnswer, GrammarPrompt, GrammarAnswer, ReviewResult } from "@nihongo/shared";
import { RubyText } from "./RubyText";

type Props = {
  item: ItemRecord;
  onAnswer: (result: ReviewResult) => void;
};

export function FlipCard({ item, onAnswer }: Props) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className={`flipcard flipcard--${item.skill}`}>
      {!flipped ? (
        <div className="flipcard__face flipcard__face--prompt">
          <PromptFace item={item} />
          <button className="flipcard__reveal" onClick={() => setFlipped(true)} type="button">
            Tap to reveal
          </button>
        </div>
      ) : (
        <div className="flipcard__face flipcard__face--answer">
          <PromptFace item={item} muted />
          <AnswerFace item={item} />
          <div className="flipcard__grade">
            <button className="flipcard__btn flipcard__btn--missed" type="button" onClick={() => onAnswer("missed")}>
              Missed
            </button>
            <button className="flipcard__btn flipcard__btn--got" type="button" onClick={() => onAnswer("got_it")}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PromptFace({ item, muted }: { item: ItemRecord; muted?: boolean }) {
  switch (item.skill) {
    case "vocab": {
      const p = item.prompt as VocabPrompt;
      return (
        <div className={`flipcard__prompt ${muted ? "is-muted" : ""}`}>
          <RubyText html={p.sentence_ruby} className="flipcard__sentence" />
          <p className="flipcard__target">{p.target}</p>
          <p className="flipcard__sentence-en">{p.sentence_english}</p>
        </div>
      );
    }
    case "grammar": {
      const p = item.prompt as GrammarPrompt;
      return (
        <div className={`flipcard__prompt ${muted ? "is-muted" : ""}`}>
          <RubyText html={p.sentence_ruby} className="flipcard__sentence" />
          <span className="flipcard__chip">{p.pattern}</span>
          <p className="flipcard__sentence-en">{p.sentence_english}</p>
        </div>
      );
    }
    default:
      return <p className="flipcard__prompt">Unsupported skill: {item.skill}</p>;
  }
}

function AnswerFace({ item }: { item: ItemRecord }) {
  switch (item.skill) {
    case "vocab": {
      const a = item.answer as VocabAnswer;
      return (
        <div className="flipcard__answer">
          <p className="flipcard__reading">{a.reading}</p>
          <p className="flipcard__meaning">{a.meaning}</p>
          {a.notes && <p className="flipcard__notes">{a.notes}</p>}
        </div>
      );
    }
    case "grammar": {
      const a = item.answer as GrammarAnswer;
      return (
        <div className="flipcard__answer">
          <p className="flipcard__explanation">{a.explanation}</p>
          {a.another_example_ruby && (
            <RubyText html={a.another_example_ruby} className="flipcard__another" />
          )}
        </div>
      );
    }
    default:
      return null;
  }
}
```

If the existing FlipCard imports differ, mirror that import style. The key new element is `flipcard__chip` for the pattern label.

- [ ] **Step 3: Add `.flipcard__chip` styles**

Append to `client/src/styles/cards.css`:

```css
/* Phase 2: pattern chip used by grammar FlipCard */
.flipcard__chip {
  display: inline-block;
  margin: var(--space-2) 0;
  padding: var(--space-1) var(--space-3);
  background: var(--color-accent-muted);
  color: var(--color-accent);
  border-radius: var(--radius-md);
  font-family: var(--font-display);
  font-size: var(--font-size-3);
  font-weight: var(--font-weight-medium);
}

.flipcard__explanation,
.flipcard__another {
  margin-top: var(--space-3);
  color: var(--color-fg-secondary);
  line-height: var(--line-height-relaxed);
}
```

- [ ] **Step 4: Verify client build**

Run: `npm --workspace client run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/FlipCard.tsx client/src/styles/cards.css
git commit -m "feat(client): FlipCard renders grammar variant with pattern chip"
```

---

### Task 12: PracticeScreen dispatches by skill (and accepts skill filter)

**Files:**
- Modify: `client/src/screens/PracticeScreen.tsx`

- [ ] **Step 1: Update PracticeScreen**

The current PracticeScreen renders `<FlipCard>` directly. With multi-skill, the FlipCard supports vocab + grammar via internal switching, so today's change is mainly accepting a `skill?` prop and passing it to `fetchQueue` + `startSession`.

Replace `client/src/screens/PracticeScreen.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { ItemRecord, ReviewResult, Skill } from "@nihongo/shared";
import { fetchQueue, startSession, endSession, submitReview } from "../api-hooks";
import { FlipCard } from "../components/FlipCard";

type Phase = "loading" | "empty" | "reviewing" | "summary" | "error";

type Props = {
  onDone: () => void;
  skill?: Skill;        // optional filter; undefined = mixed
};

export function PracticeScreen({ onDone, skill }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [index, setIndex] = useState(0);
  const [counts, setCounts] = useState({ got: 0, missed: 0 });
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ id }, queue] = await Promise.all([startSession(skill), fetchQueue(skill)]);
        if (cancelled) return;
        sessionIdRef.current = id;
        const all = [...queue.due, ...queue.new];
        setItems(all);
        setPhase(all.length === 0 ? "empty" : "reviewing");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "load failed");
        setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, [skill]);

  function handleAnswer(result: ReviewResult) {
    const item = items[index];
    if (!item) return;
    setCounts((c) => result === "got_it" ? { ...c, got: c.got + 1 } : { ...c, missed: c.missed + 1 });
    const reviewedAt = new Date().toISOString();
    void retryingSubmit({
      item_id: item.id,
      result,
      reviewed_at: reviewedAt,
      session_id: sessionIdRef.current ?? undefined,
    });
    if (index + 1 >= items.length) {
      void finishSession();
    } else {
      setIndex(index + 1);
    }
  }

  async function finishSession() {
    if (sessionIdRef.current) {
      try { await endSession(sessionIdRef.current); } catch { /* tolerate failure */ }
    }
    setPhase("summary");
  }

  if (phase === "loading") return <main className="screen screen--centered">Loading…</main>;
  if (phase === "error") return <main className="screen screen--centered"><p role="alert">{error}</p></main>;
  if (phase === "empty") {
    return (
      <main className="screen screen--centered">
        <p>Nothing due right now.</p>
        <button type="button" className="cta" onClick={onDone}>Back to Today</button>
      </main>
    );
  }
  if (phase === "summary") {
    return (
      <main className="screen screen--centered">
        <h1>Done</h1>
        <p>{counts.got} got it · {counts.missed} missed</p>
        <button type="button" className="cta" onClick={onDone}>Back to Today</button>
      </main>
    );
  }
  const current = items[index];
  if (!current) return <main className="screen">No item</main>;
  return (
    <main className="screen screen--practice">
      <p className="practice__progress">{index + 1} / {items.length}</p>
      <FlipCard key={current.id} item={current} onAnswer={handleAnswer} />
    </main>
  );
}

async function retryingSubmit(input: Parameters<typeof submitReview>[0]): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await submitReview(input);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  console.error("submitReview failed after 3 attempts", lastErr);
}
```

- [ ] **Step 2: Verify client build**

Run: `npm --workspace client run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/screens/PracticeScreen.tsx
git commit -m "feat(client): PracticeScreen accepts optional skill filter"
```

---

### Task 13: Add skill picker to `<GenerateForm>`

**Files:**
- Modify: `client/src/components/GenerateForm.tsx`

- [ ] **Step 1: Add a skill prop + select element (full mode only)**

Replace `client/src/components/GenerateForm.tsx`:

```tsx
import { useState } from "react";
import type { Skill } from "@nihongo/shared";
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
  defaultSkill?: Skill;
  lockedSkill?: Skill;          // if set, skill picker is hidden and forced to this value
  onSuccess?: () => void;
};

const SKILL_LABELS: Record<Skill, string> = {
  vocab: "Vocabulary",
  grammar: "Grammar",
  reading: "Reading",
  conjugation: "Conjugation",
  particle: "Particles",
};

export function GenerateForm({ mode, defaultCount = 10, defaultSkill = "vocab", lockedSkill, onSuccess }: Props) {
  const [skill, setSkill] = useState<Skill>(lockedSkill ?? defaultSkill);
  const [count, setCount] = useState(defaultCount);
  const [hint, setHint] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const estimatedCents = Math.max(1, Math.ceil(count * 0.001 * 100));
  const estimateLabel = `~$0.${estimatedCents.toString().padStart(2, "0")}`;
  const buttonLabel = status.kind === "submitting"
    ? "Generating…"
    : `Generate ${count} ${SKILL_LABELS[skill].toLowerCase()} (${estimateLabel})`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "submitting" });
    try {
      const r = await generateItems({
        skill,
        count,
        weakness_hint: mode === "full" && hint.trim() ? hint.trim() : undefined,
      });
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
      {mode === "full" && <h2>Generate practice</h2>}

      {mode === "full" && !lockedSkill && (
        <label className="generate-form__skill">
          <span>Skill</span>
          <select value={skill} onChange={(e) => setSkill(e.target.value as Skill)} disabled={submitting}>
            {(Object.keys(SKILL_LABELS) as Skill[]).map((s) => (
              <option key={s} value={s}>{SKILL_LABELS[s]}</option>
            ))}
          </select>
        </label>
      )}

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

      <button type="submit" disabled={submitting}>{buttonLabel}</button>

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

- [ ] **Step 2: Verify client build**

Run: `npm --workspace client run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/GenerateForm.tsx
git commit -m "feat(client): GenerateForm skill picker (full mode)"
```

---

### Task 14: Build `<SkillCard>` and `<DashboardScreen>`

**Files:**
- Create: `client/src/components/SkillCard.tsx`
- Create: `client/src/screens/DashboardScreen.tsx`
- Create: `client/src/styles/dashboard.css`
- Modify: `client/src/main.tsx`

- [ ] **Step 1: Create SkillCard**

Write `client/src/components/SkillCard.tsx`:

```tsx
import { useState } from "react";
import type { Skill } from "@nihongo/shared";
import { generateItems } from "../api-hooks";
import { ApiError } from "../api";

const LABEL: Record<Skill, string> = {
  vocab: "Vocab",
  grammar: "Grammar",
  particle: "Particles",
  conjugation: "Conjugation",
  reading: "Reading",
};

const DEFAULT_COUNT: Record<Skill, number> = {
  vocab: 10,
  grammar: 10,
  particle: 10,
  conjugation: 5,
  reading: 3,
};

type Props = {
  skill: Skill;
  due: number;
  newCount: number;
  available: boolean;       // false → "coming soon" CTA disabled
  onPractice: () => void;
  onGenerated: () => void;
};

export function SkillCard({ skill, due, newCount, available, onPractice, onGenerated }: Props) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = due + newCount;

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      await generateItems({ skill, count: DEFAULT_COUNT[skill] });
      onGenerated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <article className={`skill-card skill-card--${skill} ${available ? "" : "is-locked"}`}>
      <h3 className="skill-card__name">{LABEL[skill]}</h3>
      {!available ? (
        <p className="skill-card__hint muted">Coming soon</p>
      ) : total > 0 ? (
        <>
          <p className="skill-card__count">{total}</p>
          <p className="skill-card__hint muted">{due} due · {newCount} new</p>
          <button type="button" className="skill-card__cta" onClick={onPractice}>Practice →</button>
        </>
      ) : (
        <>
          <p className="skill-card__count skill-card__count--empty">0</p>
          <p className="skill-card__hint muted">All caught up</p>
          <button type="button" className="skill-card__cta skill-card__cta--secondary" onClick={generate} disabled={generating}>
            {generating ? "Generating…" : `Generate ${DEFAULT_COUNT[skill]}`}
          </button>
          {error && <p role="alert" className="skill-card__error">Failed — try again</p>}
        </>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Create DashboardScreen**

Write `client/src/screens/DashboardScreen.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import type { DashboardResponse, Skill } from "@nihongo/shared";
import { fetchDashboard } from "../api-hooks";
import { SkillCard } from "../components/SkillCard";

const SKILL_ORDER: Skill[] = ["vocab", "grammar", "particle", "conjugation", "reading"];
const AVAILABLE: Skill[] = ["vocab", "grammar"];

type Props = {
  onPractice: (skill?: Skill) => void;   // undefined = mixed
  onOpenSettings: () => void;
};

export function DashboardScreen({ onPractice, onOpenSettings }: Props) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchDashboard()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "load failed"));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <main className="screen"><p role="alert">Couldn't load: {error}</p></main>;
  if (!data) return <main className="screen screen--centered">Loading…</main>;

  const totalDue = SKILL_ORDER.reduce((acc, s) => acc + data.by_skill[s].due + data.by_skill[s].new, 0);
  const lastLabel = data.last_practiced_at
    ? new Date(data.last_practiced_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "never";

  return (
    <main className="screen dashboard">
      <header className="topbar">
        <h1>Today</h1>
        <button onClick={onOpenSettings} className="link">Settings</button>
      </header>

      <p className="dashboard__streak muted">
        {data.streak_days}-day streak · last practice {lastLabel}
      </p>

      <section className={`dashboard__mixed ${totalDue === 0 ? "is-empty" : ""}`}>
        {totalDue > 0 ? (
          <>
            <p className="dashboard__mixed-count">{totalDue}</p>
            <p className="muted">cards ready across all skills</p>
            <button type="button" className="cta cta--primary" onClick={() => onPractice(undefined)}>
              Start mixed practice →
            </button>
          </>
        ) : (
          <p>All caught up — pick a skill to generate more.</p>
        )}
      </section>

      <h2 className="dashboard__heading">Skills</h2>
      <section className="dashboard__skills">
        {SKILL_ORDER.map((s) => (
          <SkillCard
            key={s}
            skill={s}
            due={data.by_skill[s].due}
            newCount={data.by_skill[s].new}
            available={AVAILABLE.includes(s)}
            onPractice={() => onPractice(s)}
            onGenerated={load}
          />
        ))}
      </section>
    </main>
  );
}
```

> `AVAILABLE` grows each phase: 2.0+2.1 ships `["vocab","grammar"]`, 2.2 adds "particle", 2.3 adds "conjugation", 2.4 adds "reading". This is the single line each downstream phase updates.

- [ ] **Step 3: Create dashboard.css**

Write `client/src/styles/dashboard.css`:

```css
/* Phase 2 — Dashboard styles */

.dashboard {
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5) var(--space-6);
}

.dashboard__streak {
  text-align: center;
  font-family: var(--font-ui);
  font-size: var(--font-size-2);
}

.dashboard__mixed {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-5);
  background: var(--color-bg-raised);
  border-radius: var(--radius-xl);
  border: 1px solid var(--color-border);
}

.dashboard__mixed.is-empty {
  background: transparent;
  border-style: dashed;
}

.dashboard__mixed-count {
  font-family: var(--font-display);
  font-size: 3.5rem;
  font-weight: var(--font-weight-medium);
  line-height: 1;
  color: var(--color-fg);
}

.dashboard__mixed .cta--primary {
  margin-top: var(--space-3);
  width: 100%;
}

.dashboard__heading {
  margin-top: var(--space-2);
  font-family: var(--font-display);
  font-size: var(--font-size-3);
  color: var(--color-fg-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dashboard__skills {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.skill-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  background: var(--color-bg-raised);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  min-height: 140px;
}

.skill-card.is-locked {
  opacity: 0.5;
}

.skill-card__name {
  font-family: var(--font-display);
  font-size: var(--font-size-3);
  font-weight: var(--font-weight-medium);
}

.skill-card__count {
  font-family: var(--font-display);
  font-size: 2.5rem;
  font-weight: var(--font-weight-medium);
  line-height: 1;
}

.skill-card__count--empty { color: var(--color-fg-tertiary); }

.skill-card__hint {
  font-family: var(--font-ui);
  font-size: var(--font-size-2);
}

.skill-card__cta {
  margin-top: auto;
  padding: var(--space-2) var(--space-3);
  background: var(--color-accent);
  color: #fff;
  font-family: var(--font-ui);
  font-size: var(--font-size-2);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.skill-card__cta--secondary {
  background: transparent;
  color: var(--color-accent);
  border: 1px solid var(--color-accent);
}

.skill-card__cta:disabled { opacity: 0.6; cursor: not-allowed; }

.skill-card__error {
  color: var(--color-error);
  font-size: var(--font-size-2);
}
```

- [ ] **Step 4: Wire CSS into main.tsx**

Edit `client/src/main.tsx` — add the import:

```ts
import "./styles/dashboard.css";
```

(Place it after `import "./styles/settings.css";`)

- [ ] **Step 5: Build the client**

Run: `npm --workspace client run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/SkillCard.tsx client/src/screens/DashboardScreen.tsx client/src/styles/dashboard.css client/src/main.tsx
git commit -m "feat(client): DashboardScreen + SkillCard"
```

---

### Task 15: Wire DashboardScreen as the home route; delete TodayScreen

**Files:**
- Modify: `client/src/App.tsx`
- Delete: `client/src/screens/TodayScreen.tsx`

- [ ] **Step 1: Replace App.tsx routing**

Update `client/src/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { Skill } from "@nihongo/shared";
import { auth } from "./auth";
import { api } from "./api";
import { PasscodeScreen } from "./screens/PasscodeScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
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
  const [practiceSkill, setPracticeSkill] = useState<Skill | undefined>(undefined);

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
      <DashboardScreen
        onPractice={(skill) => { setPracticeSkill(skill); setRoute("practice"); }}
        onOpenSettings={() => setRoute("settings")}
      />
    );
  } else if (route === "practice") {
    active = <PracticeScreen skill={practiceSkill} onDone={() => setRoute("today")} />;
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

- [ ] **Step 2: Delete TodayScreen**

Run: `rm client/src/screens/TodayScreen.tsx`

- [ ] **Step 3: Verify client build**

Run: `npm --workspace client run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx client/src/screens/TodayScreen.tsx
git commit -m "feat(client): replace TodayScreen with DashboardScreen at home route"
```

---

### Task 16: Update existing e2e specs for the dashboard layout

**Files:**
- Modify: `e2e/tests/smoke.spec.ts`
- Modify: `e2e/tests/generate.spec.ts`

- [ ] **Step 1: Update smoke.spec.ts**

The smoke spec asserts "cards ready" + the big-number. With the dashboard, the equivalent assertions are on the `.dashboard__mixed-count` and the `Start mixed practice` button. Edit `e2e/tests/smoke.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";

const PASSCODE = process.env.E2E_PASSCODE ?? "test";

test.beforeEach(() => {
  loadFixture("seed-test-items");
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Passcode").fill(PASSCODE);
  await page.getByRole("button", { name: /enter/i }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

test("passcode → Dashboard shows fixture cards across skills", async ({ page }) => {
  await login(page);
  // 3 vocab seed items → mixed-count = 3
  await expect(page.locator(".dashboard__mixed-count")).toContainText("3");
});

test("wrong passcode shows an error", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Passcode").fill("definitely-wrong");
  await page.getByRole("button", { name: /enter/i }).click();
  await expect(page.getByRole("alert")).toHaveText(/wrong passcode/i);
});

test("mixed practice review advances queue", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: /Start mixed practice/i }).click();
  await page.getByRole("button", { name: /tap to reveal/i }).click();
  await page.getByRole("button", { name: /got it/i }).click();
  await expect(page.locator(".practice__progress, h1:has-text('Done')")).toBeVisible();
});
```

- [ ] **Step 2: Update generate.spec.ts**

Replace `e2e/tests/generate.spec.ts`:

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

test("empty dashboard → per-skill Generate → vocab cards appear", async ({ page }) => {
  await login(page);

  await expect(page.getByText(/All caught up/i)).toBeVisible();
  // Find the Vocab skill card's Generate button and click it
  const vocabCard = page.locator(".skill-card--vocab");
  await vocabCard.getByRole("button", { name: /Generate/i }).click();

  // Wait for the dashboard to refresh; mixed count should be 3 (fake AI returns first 3 items)
  await expect(page.locator(".dashboard__mixed-count")).toContainText("3", { timeout: 10_000 });
});

test("settings screen lists the run after generation", async ({ page }) => {
  await login(page);

  const vocabCard = page.locator(".skill-card--vocab");
  await vocabCard.getByRole("button", { name: /Generate/i }).click();
  await expect(page.locator(".dashboard__mixed-count")).toContainText("3", { timeout: 10_000 });

  await page.getByRole("button", { name: /Settings/ }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const rows = page.locator(".generations-list li");
  await expect(rows).toHaveCount(1);
});
```

- [ ] **Step 3: Run e2e locally**

In one terminal: `npm run dev:e2e`
In another: `npm run e2e`

Expected: all e2e tests pass (smoke + generate). If they fail, capture the playwright-report dir for diagnosis.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/smoke.spec.ts e2e/tests/generate.spec.ts
git commit -m "test(e2e): update specs for dashboard layout"
```

---

### Task 17: Add `grammar.spec.ts` e2e

**Files:**
- Create: `e2e/tests/grammar.spec.ts`

- [ ] **Step 1: Write the spec**

Write `e2e/tests/grammar.spec.ts`:

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

test("grammar skill: generate → review one card → queue advances", async ({ page }) => {
  await login(page);

  const grammarCard = page.locator(".skill-card--grammar");
  await expect(grammarCard).toBeVisible();
  await grammarCard.getByRole("button", { name: /Generate/i }).click();

  // After generate, the grammar card's count flips to 3 (fake AI fixture has 3 grammar items)
  await expect(grammarCard.locator(".skill-card__count")).toContainText("3", { timeout: 10_000 });

  // Tap "Practice →" on the grammar card
  await grammarCard.getByRole("button", { name: /Practice/i }).click();
  // Pattern chip should render on the prompt face
  await expect(page.locator(".flipcard__chip")).toBeVisible();
  await page.getByRole("button", { name: /tap to reveal/i }).click();
  // Answer face: explanation visible
  await expect(page.locator(".flipcard__explanation")).toBeVisible();
  await page.getByRole("button", { name: /got it/i }).click();
  await expect(page.locator(".practice__progress, h1:has-text('Done')")).toBeVisible();
});
```

- [ ] **Step 2: Run e2e**

`npm run dev:e2e` and `npm run e2e`.
Expected: smoke + generate + grammar specs all pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/grammar.spec.ts
git commit -m "test(e2e): grammar generate + review scenario"
```

---

### Task 18: Manual smoke against real Anthropic key

**Files:** none

Owner verification. Steps:

- [ ] Reset prod DB to clean state (or use staging): `psql "$DATABASE_URL" -c "TRUNCATE TABLE reviews, review_state, items, sessions, generations RESTART IDENTITY CASCADE;"`
- [ ] `npm run dev` (no FAKE_AI), open the app, log in
- [ ] Dashboard renders with all 5 skill cards; vocab + grammar enabled, the others "Coming soon"
- [ ] Tap Grammar card's "Generate 10" → wait → grammar count becomes 10
- [ ] Tap Grammar card's "Practice →" → review one card → "Got it" → queue advances
- [ ] Back on dashboard, mixed-count reflects all available cards
- [ ] Settings shows recent generations row for grammar
- [ ] `psql -c "SELECT skill, count_inserted FROM generations ORDER BY requested_at DESC;"` shows a grammar row

Then deploy to spruce-cedar with `bash scripts/deploy.sh` and repeat the smoke.

No commit.

---

## Self-review checklist

- [x] Spec coverage:
  - Generalize `/api/generate` → Task 6
  - `/api/dashboard` → Task 7
  - `/api/stats/by-skill` → Task 8
  - Grammar gen/parse → Tasks 2–4
  - `runGeneration` dispatcher → Task 5
  - DashboardScreen + SkillCard → Task 14
  - PracticeScreen skill filter → Task 12
  - GenerateForm skill picker → Task 13
  - FlipCard grammar variant → Task 11
  - E2E coverage → Tasks 16, 17
- [x] Type consistency: `runGeneration` signature `{skill, count, weakness_hint?, client?, signal?}` is the same in Task 5 (service), Task 6 (route), Task 10 (api-hook return).
- [x] No placeholders: every code step shows the actual code.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-16-phase-2-0-2-1-dashboard-grammar.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task with two-stage review.
**2. Inline Execution** — batch with checkpoints.

**Which approach?**
