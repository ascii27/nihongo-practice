# Phase 2.4 — Reading Comprehension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Reading Comprehension end-to-end. Reading items are a short Japanese passage + one English question; the FlipCard reveals an English answer (optionally with Japanese ruby support). The passage area is taller and scrollable for longer text.

**Architecture:** Reuses `<FlipCard>` from Phase 2.0+2.1 with a third variant. `runGeneration` extends to handle reading enrichment (kuromoji-ruby on passage + optional answer_japanese). Dashboard `AVAILABLE` grows to include `"reading"` — the last skill.

**Tech Stack:** Same as prior phases.

**Spec:** [`docs/superpowers/specs/2026-05-16-phase-2-multi-skill-design.md`](../specs/2026-05-16-phase-2-multi-skill-design.md) (Reading section).

**Prerequisite:** Phase 2.0+2.1 merged. (Particle/Conjugation order is independent — Reading doesn't depend on them.)

---

## File map

- `shared/src/types.ts` — add `ReadingPrompt`, `ReadingAnswer`
- `gen/src/prompt.ts` — add `buildReadingPrompt`
- `gen/src/parse.ts` — add `parseReadingBatch` + `ReadingItem`
- `gen/src/generate.ts` — add `generateReadingBatch` + `READING_FAKE`
- `gen/src/index.ts` — re-export
- `server/src/services/generate.ts` — extend dispatcher
- `server/src/services/generate.test.ts` — add reading case
- `server/src/routes/generate.test.ts` — add reading route test
- `client/src/components/FlipCard.tsx` — add reading variant (passage + question prompt face; answer face with English + optional Japanese)
- `client/src/styles/cards.css` — append reading variant styles (scrollable passage)
- `client/src/screens/DashboardScreen.tsx` — add "reading" to AVAILABLE
- `e2e/tests/reading.spec.ts` — NEW

---

### Task 1: ReadingPrompt + ReadingAnswer schemas

**Files:**
- Modify: `shared/src/types.ts`

- [ ] **Step 1: Append**

```ts
// reading — comprehend a short passage

export const ReadingPrompt = z.object({
  passage_ruby: z.string(),
  question_english: z.string(),
});
export type ReadingPrompt = z.infer<typeof ReadingPrompt>;

export const ReadingAnswer = z.object({
  answer_english: z.string(),
  answer_japanese_ruby: z.string().optional(),
});
export type ReadingAnswer = z.infer<typeof ReadingAnswer>;
```

- [ ] **Step 2: Build + commit**

Run: `npm --workspace shared run build` → PASS.

```bash
git add shared/src/types.ts
git commit -m "feat(shared): ReadingPrompt + ReadingAnswer schemas"
```

---

### Task 2: `buildReadingPrompt`

**Files:**
- Modify: `gen/src/prompt.ts`
- Modify: `gen/src/prompt.test.ts`

- [ ] **Step 1: Failing test**

Append:

```ts
import { buildReadingPrompt } from "./prompt.js";

describe("buildReadingPrompt", () => {
  it("asks for count and the reading JSON shape", () => {
    const { system, user } = buildReadingPrompt({ count: 2 });
    expect(system).toContain('"passage_japanese"');
    expect(system).toContain('"question_english"');
    expect(system).toContain('"answer_english"');
    expect(user).toContain("2");
  });
  it("includes weakness hint", () => {
    const { user } = buildReadingPrompt({ count: 1, weakness_hint: "daily life topics" });
    expect(user).toContain("daily life topics");
  });
});
```

- [ ] **Step 2: Implement**

Run: `npm --workspace gen test -- prompt` → FAIL.

Append to `gen/src/prompt.ts`:

```ts
const READING_SYSTEM = `You generate Japanese reading comprehension items for an intermediate learner. Each item is a short 3–5 sentence passage, one English comprehension question that requires brief inference (not just lookup), and a 1-sentence English answer. Optionally include a Japanese form of the answer.
Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "items": [ { "passage_japanese": "<3–5 JA sentences>", "question_english": "<EN question>", "answer_english": "<EN answer>", "answer_japanese": "<optional JA answer>" } ] }`;

export function buildReadingPrompt(args: { count: number; weakness_hint?: string }): PromptPair {
  const lines: string[] = [`Generate ${args.count} reading comprehension items.`];
  if (args.weakness_hint && args.weakness_hint.trim().length > 0) {
    lines.push(`Focus on: ${args.weakness_hint.trim()}`);
  }
  return { system: READING_SYSTEM, user: lines.join("\n") };
}
```

- [ ] **Step 3: Run + commit**

Run: `npm --workspace gen test` → PASS.

```bash
git add gen/src/prompt.ts gen/src/prompt.test.ts
git commit -m "feat(gen): reading prompt builder"
```

---

### Task 3: `parseReadingBatch`

**Files:**
- Modify: `gen/src/parse.ts`
- Modify: `gen/src/parse.test.ts`

- [ ] **Step 1: Failing test**

Append:

```ts
import { parseReadingBatch } from "./parse.js";

describe("parseReadingBatch", () => {
  it("returns items with passage_japanese/question_english/answer_english", () => {
    const raw = JSON.stringify({
      items: [{ passage_japanese: "山田さんは...", question_english: "What does Yamada do?", answer_english: "He is a teacher." }],
    });
    const out = parseReadingBatch(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.passage_japanese).toContain("山田");
  });
  it("answer_japanese is optional", () => {
    const raw = JSON.stringify({
      items: [{ passage_japanese: "x", question_english: "y", answer_english: "z", answer_japanese: "w" }],
    });
    expect(parseReadingBatch(raw)[0]!.answer_japanese).toBe("w");
  });
  it("throws on missing required field", () => {
    expect(() => parseReadingBatch(JSON.stringify({
      items: [{ passage_japanese: "x", question_english: "y" }],
    }))).toThrow();
  });
  it("strips fences", () => {
    const inner = JSON.stringify({ items: [{ passage_japanese: "x", question_english: "y", answer_english: "z" }] });
    expect(parseReadingBatch("```json\n" + inner + "\n```")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement**

Run: `npm --workspace gen test -- parse` → FAIL.

Append to `gen/src/parse.ts`:

```ts
export type ReadingItem = {
  passage_japanese: string;
  question_english: string;
  answer_english: string;
  answer_japanese?: string;
};

export function parseReadingBatch(raw: string): ReadingItem[] {
  const parsed = JSON.parse(stripFences(raw));
  const items = parsed?.items;
  if (!Array.isArray(items)) throw new Error("response missing 'items' array");
  for (const it of items) {
    if (
      typeof it?.passage_japanese !== "string" ||
      typeof it?.question_english !== "string" ||
      typeof it?.answer_english !== "string"
    ) {
      throw new Error("reading item missing required fields");
    }
    if (it.answer_japanese !== undefined && typeof it.answer_japanese !== "string") {
      throw new Error("reading item has non-string answer_japanese");
    }
  }
  return items as ReadingItem[];
}
```

- [ ] **Step 3: Run + commit**

Run: `npm --workspace gen test` → PASS.

```bash
git add gen/src/parse.ts gen/src/parse.test.ts
git commit -m "feat(gen): reading parser"
```

---

### Task 4: `generateReadingBatch` + fake fixture

**Files:**
- Modify: `gen/src/generate.ts`
- Modify: `gen/src/generate.test.ts`
- Modify: `gen/src/index.ts`

- [ ] **Step 1: Failing test**

Append:

```ts
import { generateReadingBatch } from "./generate.js";

describe("generateReadingBatch", () => {
  it("returns parsed reading items from the SDK", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ items: [
        { passage_japanese: "山田さんは...", question_english: "What does Yamada do?", answer_english: "He is a teacher." },
      ]})}],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const r = await generateReadingBatch({ count: 1, client: { messages: { create } } as never });
    expect(r.items).toHaveLength(1);
  });
  it("returns fake fixture under NIHONGO_FAKE_AI=1", async () => {
    const prev = process.env.NIHONGO_FAKE_AI;
    process.env.NIHONGO_FAKE_AI = "1";
    try {
      const r = await generateReadingBatch({ count: 2 });
      expect(r.items.length).toBeGreaterThanOrEqual(1);
    } finally {
      if (prev === undefined) delete process.env.NIHONGO_FAKE_AI;
      else process.env.NIHONGO_FAKE_AI = prev;
    }
  });
});
```

- [ ] **Step 2: Implement**

In `gen/src/generate.ts`:

Add imports:
```ts
import { buildReadingPrompt } from "./prompt.js";
import { parseReadingBatch, type ReadingItem } from "./parse.js";
```

Add `ReadingItem` to the re-exported type list.

Add the fixture:

```ts
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
```

Add the generator:

```ts
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
```

Update `gen/src/index.ts` exports — add `parseReadingBatch`, `type ReadingItem`, `buildReadingPrompt`, and `generateReadingBatch`.

- [ ] **Step 3: Run + commit**

Run: `npm --workspace gen test` → PASS.

```bash
git add gen/src/generate.ts gen/src/generate.test.ts gen/src/index.ts
git commit -m "feat(gen): generateReadingBatch + fake fixture"
```

---

### Task 5: Extend `runGeneration` for reading

**Files:**
- Modify: `server/src/services/generate.ts`
- Modify: `server/src/services/generate.test.ts`

- [ ] **Step 1: Failing test**

Append:

```ts
describe("runGeneration reading", () => {
  it("inserts reading items with passage_ruby + answer fields", async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: JSON.stringify({ items: [
            { passage_japanese: "山田さんは先生です。", question_english: "What is Yamada's job?", answer_english: "Teacher.", answer_japanese: "先生です。" },
          ]})}],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      },
    };
    const r = await runGeneration({ skill: "reading", count: 1, client });
    expect(r.status).toBe("success");

    const items = await pool.query("SELECT skill, prompt, answer FROM items");
    expect(items.rows[0].skill).toBe("reading");
    expect(items.rows[0].prompt.passage_ruby).toContain("<ruby>");
    expect(items.rows[0].prompt.question_english).toBe("What is Yamada's job?");
    expect(items.rows[0].answer.answer_english).toBe("Teacher.");
    expect(items.rows[0].answer.answer_japanese_ruby).toContain("<ruby>");
  });
});
```

- [ ] **Step 2: Update dispatcher**

In `server/src/services/generate.ts`:

Update imports (add reading):
```ts
import {
  generateVocabBatch, generateGrammarBatch, generateParticleBatch, generateConjugationBatch, generateReadingBatch,
  toRubyHtml, readingFor, computeCost, GenerateError, MODEL,
  type Usage, type VocabItem, type GrammarItem, type ParticleItem, type ConjugationItem, type ReadingItem,
} from "@nihongo/gen";
```

Add to `genFor`:
```ts
case "reading": return await generateReadingBatch(args);
```

Add to `enrichFor`:
```ts
case "reading": {
  const it = raw as ReadingItem;
  const passage_ruby = await toRubyHtml(it.passage_japanese);
  const answer_japanese_ruby = it.answer_japanese
    ? await toRubyHtml(it.answer_japanese)
    : undefined;
  return {
    prompt: { passage_ruby, question_english: it.question_english },
    answer: { answer_english: it.answer_english, answer_japanese_ruby },
  };
}
```

- [ ] **Step 3: Run + commit**

Run: `set -a; source .env; set +a; npm --workspace server test`
Expected: PASS.

```bash
git add server/src/services/generate.ts server/src/services/generate.test.ts
git commit -m "feat(server): runGeneration handles reading"
```

---

### Task 6: Reading variant in `<FlipCard>`

**Files:**
- Modify: `client/src/components/FlipCard.tsx`
- Modify: `client/src/styles/cards.css`

- [ ] **Step 1: Extend PromptFace and AnswerFace switches**

In `client/src/components/FlipCard.tsx`, add `ReadingPrompt`/`ReadingAnswer` to the imports:

```tsx
import type {
  ItemRecord, ReviewResult,
  VocabPrompt, VocabAnswer,
  GrammarPrompt, GrammarAnswer,
  ReadingPrompt, ReadingAnswer,
} from "@nihongo/shared";
```

Add a new `case "reading":` in `PromptFace`:

```tsx
case "reading": {
  const p = item.prompt as ReadingPrompt;
  return (
    <div className={`flipcard__prompt flipcard__prompt--reading ${muted ? "is-muted" : ""}`}>
      <RubyText html={p.passage_ruby} className="flipcard__passage" />
      <p className="flipcard__question">{p.question_english}</p>
    </div>
  );
}
```

Add a new `case "reading":` in `AnswerFace`:

```tsx
case "reading": {
  const a = item.answer as ReadingAnswer;
  return (
    <div className="flipcard__answer">
      <p className="flipcard__answer-en">{a.answer_english}</p>
      {a.answer_japanese_ruby && (
        <RubyText html={a.answer_japanese_ruby} className="flipcard__answer-ja" />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add reading-specific styles (scrollable passage)**

Append to `client/src/styles/cards.css`:

```css
/* FlipCard reading variant — longer text, scrollable passage area */
.flipcard__prompt--reading {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-height: 60vh;
  overflow-y: auto;
}

.flipcard__passage {
  font-family: var(--font-display);
  font-size: var(--font-size-4);
  line-height: var(--line-height-relaxed);
}

.flipcard__question {
  margin-top: var(--space-3);
  padding: var(--space-3);
  background: var(--color-bg-overlay);
  border-radius: var(--radius-md);
  color: var(--color-fg-secondary);
  font-family: var(--font-ui);
  font-size: var(--font-size-3);
}

.flipcard__answer-en {
  font-size: var(--font-size-4);
  margin-bottom: var(--space-3);
}

.flipcard__answer-ja {
  color: var(--color-fg-secondary);
  font-size: var(--font-size-3);
}
```

- [ ] **Step 3: Verify + commit**

Run: `npm --workspace client run build`
Expected: PASS.

```bash
git add client/src/components/FlipCard.tsx client/src/styles/cards.css
git commit -m "feat(client): FlipCard reading variant with scrollable passage"
```

---

### Task 7: Enable Reading on the dashboard

**Files:**
- Modify: `client/src/screens/DashboardScreen.tsx`

- [ ] **Step 1: Update AVAILABLE**

```ts
const AVAILABLE: Skill[] = ["vocab", "grammar", "particle", "conjugation", "reading"];
```

(All five available — the dashboard's "Coming soon" lock is now empty.)

- [ ] **Step 2: Verify + commit**

Run: `npm --workspace client run build`
Expected: PASS.

```bash
git add client/src/screens/DashboardScreen.tsx
git commit -m "feat(client): enable Reading card on dashboard (all 5 skills live)"
```

---

### Task 8: Add reading route test

**Files:**
- Modify: `server/src/routes/generate.test.ts`

- [ ] **Step 1: Append**

```ts
describe("POST /api/generate (reading)", () => {
  it("inserts reading items when skill=reading", async () => {
    const res = await request(app)
      .post("/api/generate")
      .set("X-Passcode", PASSCODE)
      .send({ skill: "reading", count: 2 });
    expect(res.status).toBe(200);
    expect(res.body.items_created).toBeGreaterThanOrEqual(1);
    const r = await pool.query("SELECT count(*)::int AS c FROM items WHERE skill='reading' AND source='ai'");
    expect(r.rows[0].c).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `set -a; source .env; set +a; npm --workspace server test`
Expected: PASS.

```bash
git add server/src/routes/generate.test.ts
git commit -m "test(server): reading route happy path"
```

---

### Task 9: E2E reading scenario

**Files:**
- Create: `e2e/tests/reading.spec.ts`

- [ ] **Step 1: Write the spec**

Write `e2e/tests/reading.spec.ts`:

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

test("reading: generate → reveal answer → grade", async ({ page }) => {
  await login(page);

  const card = page.locator(".skill-card--reading");
  await card.getByRole("button", { name: /Generate/i }).click();
  // READING_FAKE has 2 items; default count is 3, so slice clamps to 2.
  await expect(card.locator(".skill-card__count")).toContainText("2", { timeout: 10_000 });

  await card.getByRole("button", { name: /Practice/i }).click();
  await expect(page.locator(".flipcard__passage")).toBeVisible();
  await expect(page.locator(".flipcard__question")).toBeVisible();

  await page.getByRole("button", { name: /tap to reveal/i }).click();
  await expect(page.locator(".flipcard__answer-en")).toBeVisible();

  await page.getByRole("button", { name: /got it/i }).click();
  await expect(page.locator(".practice__progress, h1:has-text('Done')")).toBeVisible();
});
```

- [ ] **Step 2: Run + commit**

`npm run dev:e2e` + `npm run e2e`.
Expected: smoke + generate + grammar + particle + conjugation + reading all green.

```bash
git add e2e/tests/reading.spec.ts
git commit -m "test(e2e): reading generate + reveal + grade scenario"
```

---

### Task 10: Manual smoke

- [ ] Deploy via `bash scripts/deploy.sh`
- [ ] Open the app, log in
- [ ] Dashboard shows all five skill cards as available; nothing labeled "Coming soon"
- [ ] Generate 3 reading items → wait (reading is the slowest generation — Claude produces multi-paragraph passages)
- [ ] Tap Practice → confirm passage is readable, scrollable if long, ruby rendered correctly
- [ ] Tap reveal → English answer + optional Japanese answer with ruby
- [ ] Tap "Got it" → next card or summary

After Phase 2.4 ships, Phase 2 is complete.

---

## Self-review

- [x] All 10 tasks cover the spec's reading section
- [x] FlipCard variant pattern is consistent with vocab/grammar variants (added in Phase 2.0+2.1)
- [x] Scrollable passage area handled via `.flipcard__prompt--reading { max-height: 60vh; overflow-y: auto; }`
- [x] After this phase, `AVAILABLE` has all 5 skills

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-05-16-phase-2-4-reading.md`.
