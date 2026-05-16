# Phase 2.2 — Particle Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Particle skill end-to-end — a multiple-choice card that asks the owner to pick the right particle for a blanked sentence — riding on the dashboard + dispatcher built in Phase 2.0+2.1.

**Architecture:** Particle output is structurally different from vocab/grammar (4-option MC + correct index + explanation). New `<MultipleChoiceCard>` component handles the auto-grading flow. Server-side, `runGeneration` is extended to handle particle enrichment (ruby on the blanked sentence). The dashboard's `AVAILABLE` set grows to include `"particle"`.

**Tech Stack:** Same as Phase 2.0+2.1.

**Spec:** [`docs/superpowers/specs/2026-05-16-phase-2-multi-skill-design.md`](../specs/2026-05-16-phase-2-multi-skill-design.md) (Particle section).

**Prerequisite:** Phase 2.0+2.1 must be merged. This plan assumes `runGeneration`, `<DashboardScreen>`, `<SkillCard>`, and `<PracticeScreen>` skill dispatch are in place.

---

## File map

- `shared/src/types.ts` — add `ParticlePrompt`, `ParticleAnswer`
- `gen/src/prompt.ts` — add `buildParticlePrompt`
- `gen/src/parse.ts` — add `parseParticleBatch` + `ParticleItem` type
- `gen/src/generate.ts` — add `generateParticleBatch` + `PARTICLE_FAKE`
- `gen/src/index.ts` — re-export
- `server/src/services/generate.ts` — extend `genFor` + `enrichFor` switch for particle
- `server/src/services/generate.test.ts` — add particle case
- `server/src/routes/generate.test.ts` — add particle route test
- `client/src/components/MultipleChoiceCard.tsx` — NEW
- `client/src/styles/cards.css` — append MC styles
- `client/src/screens/PracticeScreen.tsx` — dispatch particle items to MultipleChoiceCard
- `client/src/screens/DashboardScreen.tsx` — add "particle" to `AVAILABLE`
- `e2e/tests/particle.spec.ts` — NEW

---

### Task 1: Add ParticlePrompt + ParticleAnswer schemas to shared

**Files:**
- Modify: `shared/src/types.ts`

- [ ] **Step 1: Append the schemas**

Append to `shared/src/types.ts` after `GrammarAnswer`:

```ts
// particle — pick the right particle (multiple choice)

export const ParticlePrompt = z.object({
  sentence_ruby_blanked: z.string(),
  options: z.array(z.string()).length(4),
  answer_index: z.number().int().min(0).max(3),
});
export type ParticlePrompt = z.infer<typeof ParticlePrompt>;

export const ParticleAnswer = z.object({
  explanation: z.string(),
});
export type ParticleAnswer = z.infer<typeof ParticleAnswer>;
```

- [ ] **Step 2: Verify shared build**

Run: `npm --workspace shared run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat(shared): ParticlePrompt + ParticleAnswer schemas"
```

---

### Task 2: Add `buildParticlePrompt`

**Files:**
- Modify: `gen/src/prompt.ts`
- Modify: `gen/src/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `gen/src/prompt.test.ts`:

```ts
import { buildParticlePrompt } from "./prompt.js";

describe("buildParticlePrompt", () => {
  it("asks for the requested count and the four-option shape", () => {
    const { system, user } = buildParticlePrompt({ count: 3 });
    expect(system).toMatch(/JSON/i);
    expect(system).toContain('"options"');
    expect(system).toContain('"answer_index"');
    expect(system).toContain('"explanation"');
    expect(user).toContain("3");
  });

  it("includes the weakness hint when provided", () => {
    const { user } = buildParticlePrompt({ count: 2, weakness_hint: "は vs が" });
    expect(user).toContain("は vs が");
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npm --workspace gen test -- prompt`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement**

Append to `gen/src/prompt.ts`:

```ts
const PARTICLE_SYSTEM = `You generate Japanese particle drill cards. Each card is a sentence with exactly one particle slot, marked by three underscores '___'. Provide four particle options (one correct, three plausible distractors). The correct option's position should vary across the batch.
Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "items": [ { "sentence_japanese_blanked": "<JA with ___>", "options": ["<p1>", "<p2>", "<p3>", "<p4>"], "answer_index": 0|1|2|3, "explanation": "<1 sentence>" } ] }`;

export function buildParticlePrompt(args: { count: number; weakness_hint?: string }): PromptPair {
  const lines: string[] = [`Generate ${args.count} particle drill cards.`];
  if (args.weakness_hint && args.weakness_hint.trim().length > 0) {
    lines.push(`Focus on: ${args.weakness_hint.trim()}`);
  }
  return { system: PARTICLE_SYSTEM, user: lines.join("\n") };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm --workspace gen test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gen/src/prompt.ts gen/src/prompt.test.ts
git commit -m "feat(gen): particle prompt builder"
```

---

### Task 3: Add `parseParticleBatch`

**Files:**
- Modify: `gen/src/parse.ts`
- Modify: `gen/src/parse.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `gen/src/parse.test.ts`:

```ts
import { parseParticleBatch } from "./parse.js";

describe("parseParticleBatch", () => {
  it("returns items with sentence_japanese_blanked, options (4), answer_index, explanation", () => {
    const raw = JSON.stringify({
      items: [{
        sentence_japanese_blanked: "学校___行きます。",
        options: ["は", "が", "に", "を"],
        answer_index: 2,
        explanation: "に marks the destination of movement.",
      }],
    });
    const out = parseParticleBatch(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.options).toHaveLength(4);
    expect(out[0]!.answer_index).toBe(2);
  });

  it("throws when options is not a 4-element array", () => {
    expect(() => parseParticleBatch(JSON.stringify({
      items: [{ sentence_japanese_blanked: "x", options: ["a","b","c"], answer_index: 0, explanation: "y" }],
    }))).toThrow();
  });

  it("throws when answer_index is out of range", () => {
    expect(() => parseParticleBatch(JSON.stringify({
      items: [{ sentence_japanese_blanked: "x", options: ["a","b","c","d"], answer_index: 4, explanation: "y" }],
    }))).toThrow();
  });

  it("throws when a required field is missing", () => {
    expect(() => parseParticleBatch(JSON.stringify({
      items: [{ sentence_japanese_blanked: "x", options: ["a","b","c","d"], answer_index: 0 }],
    }))).toThrow();
  });

  it("strips ```json fences", () => {
    const inner = JSON.stringify({
      items: [{ sentence_japanese_blanked: "x", options: ["a","b","c","d"], answer_index: 0, explanation: "y" }],
    });
    expect(parseParticleBatch("```json\n" + inner + "\n```")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npm --workspace gen test -- parse`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `gen/src/parse.ts`:

```ts
export type ParticleItem = {
  sentence_japanese_blanked: string;
  options: string[];
  answer_index: number;
  explanation: string;
};

export function parseParticleBatch(raw: string): ParticleItem[] {
  const parsed = JSON.parse(stripFences(raw));
  const items = parsed?.items;
  if (!Array.isArray(items)) throw new Error("response missing 'items' array");
  for (const it of items) {
    if (
      typeof it?.sentence_japanese_blanked !== "string" ||
      !Array.isArray(it?.options) ||
      it.options.length !== 4 ||
      it.options.some((o: unknown) => typeof o !== "string") ||
      typeof it?.answer_index !== "number" ||
      it.answer_index < 0 || it.answer_index > 3 ||
      !Number.isInteger(it.answer_index) ||
      typeof it?.explanation !== "string"
    ) {
      throw new Error("particle item missing or invalid required fields");
    }
  }
  return items as ParticleItem[];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm --workspace gen test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gen/src/parse.ts gen/src/parse.test.ts
git commit -m "feat(gen): particle parser"
```

---

### Task 4: Add `generateParticleBatch` + fake fixture

**Files:**
- Modify: `gen/src/generate.ts`
- Modify: `gen/src/generate.test.ts`
- Modify: `gen/src/index.ts`

- [ ] **Step 1: Write the failing test**

Append to `gen/src/generate.test.ts`:

```ts
import { generateParticleBatch } from "./generate.js";

describe("generateParticleBatch", () => {
  it("returns parsed particle items from the SDK", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ items: [
        { sentence_japanese_blanked: "学校___行きます。", options: ["は","が","に","を"], answer_index: 2, explanation: "..." },
      ]})}],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const r = await generateParticleBatch({ count: 1, client: { messages: { create } } as never });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.options).toHaveLength(4);
  });

  it("returns fake fixture under NIHONGO_FAKE_AI=1", async () => {
    const prev = process.env.NIHONGO_FAKE_AI;
    process.env.NIHONGO_FAKE_AI = "1";
    try {
      const r = await generateParticleBatch({ count: 2 });
      expect(r.items).toHaveLength(2);
      for (const it of r.items) {
        expect(it.options).toHaveLength(4);
        expect(it.answer_index).toBeGreaterThanOrEqual(0);
        expect(it.answer_index).toBeLessThanOrEqual(3);
      }
    } finally {
      if (prev === undefined) delete process.env.NIHONGO_FAKE_AI;
      else process.env.NIHONGO_FAKE_AI = prev;
    }
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npm --workspace gen test`
Expected: FAIL — `generateParticleBatch` not exported.

- [ ] **Step 3: Implement**

Add imports at the top of `gen/src/generate.ts`:

```ts
import { buildParticlePrompt } from "./prompt.js";
import { parseParticleBatch, type ParticleItem } from "./parse.js";
```

Add to the `export type { ... }` line: `ParticleItem`.

Add the fixture (after `GRAMMAR_FAKE`):

```ts
const PARTICLE_FAKE: ParticleItem[] = [
  { sentence_japanese_blanked: "学校___行きます。", options: ["は","が","に","を"], answer_index: 2, explanation: "に marks the destination of movement." },
  { sentence_japanese_blanked: "本___読みました。", options: ["は","が","に","を"], answer_index: 3, explanation: "を marks the direct object." },
  { sentence_japanese_blanked: "私___学生です。", options: ["は","が","に","を"], answer_index: 0, explanation: "は marks the topic." },
];
```

Add the generator at the bottom (after `generateGrammarBatch`):

```ts
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
```

- [ ] **Step 4: Re-export**

Edit `gen/src/index.ts` — add `generateParticleBatch` to the generate export and `parseParticleBatch, type ParticleItem` to the parse export and `buildParticlePrompt` to the prompt export:

```ts
export { computeCost, MODEL, INPUT_PER_MTOK, OUTPUT_PER_MTOK, type Usage } from "./pricing.js";
export { stripFences, parseVocabBatch, parseSentencesForCards, parseGrammarBatch, parseParticleBatch, type VocabItem, type SentenceForCard, type GrammarItem, type ParticleItem } from "./parse.js";
export { buildVocabPrompt, buildSentencesForCardsPrompt, buildGrammarPrompt, buildParticlePrompt, type CardInput } from "./prompt.js";
export { toRubyHtml, readingFor, getTokenizer } from "./furigana.js";
export {
  generateVocabBatch,
  generateGrammarBatch,
  generateParticleBatch,
  generateSentencesForCards,
  GenerateError,
} from "./generate.js";
```

- [ ] **Step 5: Run to verify pass**

Run: `npm --workspace gen test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add gen/src/generate.ts gen/src/generate.test.ts gen/src/index.ts
git commit -m "feat(gen): generateParticleBatch + fake fixture"
```

---

### Task 5: Extend `runGeneration` dispatcher for particle

**Files:**
- Modify: `server/src/services/generate.ts`
- Modify: `server/src/services/generate.test.ts`

- [ ] **Step 1: Update tests first**

Append to `server/src/services/generate.test.ts`:

```ts
describe("runGeneration particle", () => {
  it("inserts particle items with sentence_ruby_blanked + 4 options + answer_index", async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: JSON.stringify({ items: [
            { sentence_japanese_blanked: "学校___行きます。", options: ["は","が","に","を"], answer_index: 2, explanation: "..." },
          ]})}],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      },
    };
    const r = await runGeneration({ skill: "particle", count: 1, client });
    expect(r.status).toBe("success");
    expect(r.items_created).toBe(1);

    const items = await pool.query("SELECT skill, prompt, answer FROM items");
    expect(items.rows[0].skill).toBe("particle");
    expect(items.rows[0].prompt.sentence_ruby_blanked).toContain("<ruby>");
    expect(items.rows[0].prompt.options).toEqual(["は","が","に","を"]);
    expect(items.rows[0].prompt.answer_index).toBe(2);
    expect(items.rows[0].answer.explanation).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `set -a; source .env; set +a; npm --workspace server test -- services/generate`
Expected: FAIL — `runGeneration` throws `not implemented` for particle.

- [ ] **Step 3: Update `genFor` and `enrichFor`**

In `server/src/services/generate.ts`:

Update the import block to include particle:

```ts
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
```

Add to the `genFor` switch:

```ts
case "particle": return await generateParticleBatch(args);
```

Add to the `enrichFor` switch:

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `set -a; source .env; set +a; npm --workspace server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/generate.ts server/src/services/generate.test.ts
git commit -m "feat(server): runGeneration handles particle skill"
```

---

### Task 6: Add particle route test

**Files:**
- Modify: `server/src/routes/generate.test.ts`

- [ ] **Step 1: Append test**

Append:

```ts
describe("POST /api/generate (particle)", () => {
  it("inserts particle items when skill=particle", async () => {
    const res = await request(app)
      .post("/api/generate")
      .set("X-Passcode", PASSCODE)
      .send({ skill: "particle", count: 2 });
    expect(res.status).toBe(200);
    expect(res.body.items_created).toBe(2);
    const r = await pool.query("SELECT count(*)::int AS c FROM items WHERE skill='particle' AND source='ai'");
    expect(r.rows[0].c).toBe(2);
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `set -a; source .env; set +a; npm --workspace server test`
Expected: PASS.

```bash
git add server/src/routes/generate.test.ts
git commit -m "test(server): particle route happy path"
```

---

### Task 7: Build `<MultipleChoiceCard>`

**Files:**
- Create: `client/src/components/MultipleChoiceCard.tsx`
- Modify: `client/src/styles/cards.css`

- [ ] **Step 1: Create the component**

Write `client/src/components/MultipleChoiceCard.tsx`:

```tsx
import { useState } from "react";
import type { ItemRecord, ParticlePrompt, ParticleAnswer, ReviewResult } from "@nihongo/shared";
import { RubyText } from "./RubyText";

type Props = {
  item: ItemRecord;
  onAnswer: (result: ReviewResult) => void;
};

export function MultipleChoiceCard({ item, onAnswer }: Props) {
  const prompt = item.prompt as ParticlePrompt;
  const answer = item.answer as ParticleAnswer;
  const [chosen, setChosen] = useState<number | null>(null);

  const decided = chosen !== null;
  const correct = decided && chosen === prompt.answer_index;

  function choose(i: number) {
    if (decided) return;
    setChosen(i);
  }

  function next() {
    onAnswer(correct ? "got_it" : "missed");
  }

  return (
    <div className="mc-card">
      <RubyText html={prompt.sentence_ruby_blanked} className="mc-card__sentence" />

      <div className="mc-card__options">
        {prompt.options.map((opt, i) => {
          const isChosen = i === chosen;
          const isCorrect = i === prompt.answer_index;
          const cls = !decided
            ? "mc-option"
            : isChosen && isCorrect ? "mc-option mc-option--correct"
            : isChosen && !isCorrect ? "mc-option mc-option--wrong"
            : isCorrect ? "mc-option mc-option--correct-reveal"
            : "mc-option mc-option--muted";
          return (
            <button
              key={i}
              type="button"
              className={cls}
              onClick={() => choose(i)}
              disabled={decided}
              aria-pressed={isChosen}
            >
              {opt}
              {decided && isCorrect && <span aria-hidden> ✓</span>}
              {decided && isChosen && !isCorrect && <span aria-hidden> ✗</span>}
            </button>
          );
        })}
      </div>

      {decided && (
        <>
          <p className={`mc-card__feedback ${correct ? "is-correct" : "is-wrong"}`}>
            {correct ? "Correct" : "Not quite"} — {answer.explanation}
          </p>
          <button type="button" className="cta cta--primary" onClick={next}>
            Next →
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Append MC styles**

Append to `client/src/styles/cards.css`:

```css
/* MultipleChoiceCard (particle skill) */
.mc-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
}

.mc-card__sentence {
  font-family: var(--font-display);
  font-size: var(--font-size-5);
  line-height: var(--line-height-relaxed);
  text-align: center;
}

.mc-card__options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.mc-option {
  min-height: 56px;
  padding: var(--space-3);
  background: var(--color-bg-raised);
  color: var(--color-fg);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  font-family: var(--font-display);
  font-size: var(--font-size-5);
  cursor: pointer;
}

.mc-option:disabled { cursor: default; }
.mc-option--correct { background: var(--color-success-muted); border-color: var(--color-success); color: var(--color-success); }
.mc-option--correct-reveal { border-color: var(--color-success); color: var(--color-success); }
.mc-option--wrong { background: var(--color-error-muted); border-color: var(--color-error); color: var(--color-error); }
.mc-option--muted { opacity: 0.5; }

.mc-card__feedback {
  font-family: var(--font-ui);
  font-size: var(--font-size-2);
  line-height: var(--line-height-relaxed);
  color: var(--color-fg-secondary);
  text-align: center;
}
.mc-card__feedback.is-correct { color: var(--color-success); }
.mc-card__feedback.is-wrong { color: var(--color-error); }
```

- [ ] **Step 3: Verify client build**

Run: `npm --workspace client run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/MultipleChoiceCard.tsx client/src/styles/cards.css
git commit -m "feat(client): MultipleChoiceCard for particle skill"
```

---

### Task 8: PracticeScreen dispatches particle → MultipleChoiceCard

**Files:**
- Modify: `client/src/screens/PracticeScreen.tsx`

- [ ] **Step 1: Update the render**

Find the line:

```tsx
<FlipCard key={current.id} item={current} onAnswer={handleAnswer} />
```

Replace the JSX with a per-skill dispatch:

```tsx
{current.skill === "particle" ? (
  <MultipleChoiceCard key={current.id} item={current} onAnswer={handleAnswer} />
) : (
  <FlipCard key={current.id} item={current} onAnswer={handleAnswer} />
)}
```

Add the import at the top:

```tsx
import { MultipleChoiceCard } from "../components/MultipleChoiceCard";
```

- [ ] **Step 2: Verify build**

Run: `npm --workspace client run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/screens/PracticeScreen.tsx
git commit -m "feat(client): PracticeScreen dispatches particle items to MultipleChoiceCard"
```

---

### Task 9: Enable Particle on the dashboard

**Files:**
- Modify: `client/src/screens/DashboardScreen.tsx`

- [ ] **Step 1: Update AVAILABLE**

Find:

```ts
const AVAILABLE: Skill[] = ["vocab", "grammar"];
```

Change to:

```ts
const AVAILABLE: Skill[] = ["vocab", "grammar", "particle"];
```

- [ ] **Step 2: Verify build**

Run: `npm --workspace client run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/screens/DashboardScreen.tsx
git commit -m "feat(client): enable Particle card on dashboard"
```

---

### Task 10: E2E particle scenario

**Files:**
- Create: `e2e/tests/particle.spec.ts`

- [ ] **Step 1: Write the spec**

Write `e2e/tests/particle.spec.ts`:

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

test("particle skill: generate → answer one MC card", async ({ page }) => {
  await login(page);

  const card = page.locator(".skill-card--particle");
  await card.getByRole("button", { name: /Generate/i }).click();
  await expect(card.locator(".skill-card__count")).toContainText("3", { timeout: 10_000 });

  await card.getByRole("button", { name: /Practice/i }).click();
  // Four option buttons rendered
  await expect(page.locator(".mc-option")).toHaveCount(4);
  // Tap the first option — whatever the result, feedback appears
  await page.locator(".mc-option").first().click();
  await expect(page.locator(".mc-card__feedback")).toBeVisible();
  await page.getByRole("button", { name: /Next/i }).click();
  await expect(page.locator(".practice__progress, h1:has-text('Done')")).toBeVisible();
});
```

- [ ] **Step 2: Run e2e**

`npm run dev:e2e` (one terminal) + `npm run e2e` (another).
Expected: smoke + generate + grammar + particle specs all green.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/particle.spec.ts
git commit -m "test(e2e): particle generate + answer scenario"
```

---

### Task 11: Manual smoke against real Anthropic key

Owner verification:

- [ ] Reset DB (or use staging): `psql "$DATABASE_URL" -c "TRUNCATE TABLE reviews, review_state, items, sessions, generations RESTART IDENTITY CASCADE;"`
- [ ] `npm run dev` (no FAKE_AI), log in
- [ ] Dashboard shows Vocab, Grammar, **Particle** as available; reading + conjugation locked
- [ ] Tap Particle "Generate 10" → wait → count becomes 10
- [ ] Tap Particle "Practice →" → answer a few MC cards → green/red feedback works
- [ ] `psql -c "SELECT skill, count_inserted FROM generations WHERE skill='particle' ORDER BY requested_at DESC;"` shows a row
- [ ] Deploy to spruce-cedar with `bash scripts/deploy.sh` and repeat the smoke.

No commit.

---

## Self-review

- [x] All 11 tasks cover the spec's particle section
- [x] `runGeneration` dispatcher already handles failure paths (inherited from Phase 2.0+2.1); no new failed-path tests needed
- [x] `MultipleChoiceCard` auto-grades and maps to `got_it`/`missed` per Leitner — handles the spec's "no self-grade for MC" decision
- [x] Dashboard's `AVAILABLE` is the single line that gates per-skill availability — bumped from 2 entries to 3
- [x] No placeholders

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-05-16-phase-2-2-particle.md`. Use subagent-driven-development (recommended) or executing-plans.
