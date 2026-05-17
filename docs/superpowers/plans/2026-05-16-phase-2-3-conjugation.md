# Phase 2.3 — Conjugation Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Conjugation skill end-to-end — a typed-input card where the owner enters a conjugated form of a base verb, with auto-grade + self-override. Adds a `reviews.answer_given` column to capture what the owner typed for later analysis.

**Architecture:** New `<TypedInputCard>` component handles the input + normalize + auto-grade + self-override flow. A small `normalizeKana(s)` helper does NFKC + katakana→hiragana so the user's IME output matches the expected form. `runGeneration` extends to enrich base/expected with ruby. `reviews` table gains a nullable `answer_given` text column for forensic capture.

**Tech Stack:** Same as prior phases.

**Spec:** [`docs/superpowers/specs/2026-05-16-phase-2-multi-skill-design.md`](../specs/2026-05-16-phase-2-multi-skill-design.md) (Conjugation section).

**Prerequisite:** Phase 2.0+2.1 (and ideally 2.2) merged.

---

## File map

- `db/migrations/1779494400000_reviews_answer_given.sql` — add nullable text column
- `shared/src/types.ts` — add `ConjugationPrompt`, `ConjugationAnswer`; extend `SubmitReviewRequest` with optional `answer_given`
- `gen/src/prompt.ts` — add `buildConjugationPrompt`
- `gen/src/parse.ts` — add `parseConjugationBatch` + `ConjugationItem`
- `gen/src/generate.ts` — add `generateConjugationBatch` + `CONJUGATION_FAKE`
- `gen/src/index.ts` — re-export
- `server/src/services/generate.ts` — extend dispatcher for conjugation
- `server/src/services/generate.test.ts` — add conjugation case
- `server/src/routes/reviews.ts` — accept + persist `answer_given`
- `server/src/routes/reviews.test.ts` — assert persistence
- `server/src/routes/generate.test.ts` — add conjugation route test
- `client/src/lib/kana.ts` — NEW: `normalizeKana(s)` helper
- `client/src/lib/kana.test.ts` — NEW: unit tests for normalize (vitest in client? See step 1 below)
- `client/src/components/TypedInputCard.tsx` — NEW
- `client/src/styles/cards.css` — append TypedInputCard styles
- `client/src/screens/PracticeScreen.tsx` — dispatch conjugation → TypedInputCard
- `client/src/screens/DashboardScreen.tsx` — add "conjugation" to AVAILABLE
- `client/src/api-hooks.ts` — `submitReview` accepts optional `answer_given`
- `e2e/tests/conjugation.spec.ts` — NEW

> **Note on client tests:** the client workspace doesn't currently run vitest. The kana normalization helper is small enough that test coverage via the e2e flow is acceptable, but adding a tiny vitest is cheap — see Task 7.

---

### Task 1: DB migration — `reviews.answer_given`

**Files:**
- Create: `db/migrations/1779494400000_reviews_answer_given.sql`
- Modify: `server/src/db/reset.ts` — no change needed (TRUNCATE already covers reviews)

- [ ] **Step 1: Write the migration**

Write `db/migrations/1779494400000_reviews_answer_given.sql`:

```sql
-- Phase 2.3: capture what the owner typed during conjugation drills.
-- Nullable because vocab/grammar/reading/particle don't use this.
ALTER TABLE reviews ADD COLUMN answer_given text;
```

- [ ] **Step 2: Apply the migration locally**

Run:
```bash
set -a; source .env; set +a
npm --workspace server run db:migrate
```
Expected: migration `1779494400000_reviews_answer_given` applied.

Verify:
```bash
psql "$DATABASE_URL" -c "\d reviews" | grep answer_given
```
Expected: `answer_given | text` line.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/1779494400000_reviews_answer_given.sql
git commit -m "feat(db): reviews.answer_given column for conjugation forensics"
```

---

### Task 2: Extend shared schemas

**Files:**
- Modify: `shared/src/types.ts`

- [ ] **Step 1: Append the conjugation schemas and extend SubmitReviewRequest**

Append after the particle schemas:

```ts
// conjugation — produce a specific conjugated form

export const ConjugationPrompt = z.object({
  base: z.string(),
  base_ruby: z.string(),
  tense: z.string(),
});
export type ConjugationPrompt = z.infer<typeof ConjugationPrompt>;

export const ConjugationAnswer = z.object({
  expected: z.string(),
  expected_ruby: z.string(),
  alternates: z.array(z.string()).optional(),
});
export type ConjugationAnswer = z.infer<typeof ConjugationAnswer>;
```

Update `SubmitReviewRequest` to include an optional `answer_given`:

Find:
```ts
export const SubmitReviewRequest = z.object({
  item_id: z.string().uuid(),
  result: ReviewResult,
  reviewed_at: z.string().datetime(),
  session_id: z.string().uuid().optional(),
});
```

Replace with:
```ts
export const SubmitReviewRequest = z.object({
  item_id: z.string().uuid(),
  result: ReviewResult,
  reviewed_at: z.string().datetime(),
  session_id: z.string().uuid().optional(),
  answer_given: z.string().max(200).optional(),
});
```

- [ ] **Step 2: Verify shared build**

Run: `npm --workspace shared run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat(shared): ConjugationPrompt/Answer + SubmitReviewRequest.answer_given"
```

---

### Task 3: `buildConjugationPrompt`

**Files:**
- Modify: `gen/src/prompt.ts`
- Modify: `gen/src/prompt.test.ts`

- [ ] **Step 1: Failing test**

Append:

```ts
import { buildConjugationPrompt } from "./prompt.js";

describe("buildConjugationPrompt", () => {
  it("requests the count and the conjugation JSON shape", () => {
    const { system, user } = buildConjugationPrompt({ count: 5 });
    expect(system).toContain('"base"');
    expect(system).toContain('"tense"');
    expect(system).toContain('"expected"');
    expect(user).toContain("5");
  });
  it("includes weakness hint", () => {
    const { user } = buildConjugationPrompt({ count: 2, weakness_hint: "te-form" });
    expect(user).toContain("te-form");
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npm --workspace gen test -- prompt`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `gen/src/prompt.ts`:

```ts
const CONJUGATION_SYSTEM = `You generate Japanese verb conjugation drills. For each item provide a base verb (dictionary form), the requested tense, the expected conjugated form, and optionally a list of common acceptable alternates. Mix verb classes (godan, ichidan, irregular) and tenses (te-form, past polite, past plain, negative polite, negative plain, potential, passive, causative, ば conditional, たら conditional, volitional) across the batch.
Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "items": [ { "base": "<dictionary form, e.g. 食べる>", "tense": "<English tense label>", "expected": "<expected conjugated form, kana or kanji+kana>", "alternates": ["<other accepted forms, optional>"] } ] }`;

export function buildConjugationPrompt(args: { count: number; weakness_hint?: string }): PromptPair {
  const lines: string[] = [`Generate ${args.count} verb conjugation drills.`];
  if (args.weakness_hint && args.weakness_hint.trim().length > 0) {
    lines.push(`Focus on: ${args.weakness_hint.trim()}`);
  }
  return { system: CONJUGATION_SYSTEM, user: lines.join("\n") };
}
```

- [ ] **Step 4: Run + commit**

Run: `npm --workspace gen test`
Expected: PASS.

```bash
git add gen/src/prompt.ts gen/src/prompt.test.ts
git commit -m "feat(gen): conjugation prompt builder"
```

---

### Task 4: `parseConjugationBatch`

**Files:**
- Modify: `gen/src/parse.ts`
- Modify: `gen/src/parse.test.ts`

- [ ] **Step 1: Failing test**

Append:

```ts
import { parseConjugationBatch } from "./parse.js";

describe("parseConjugationBatch", () => {
  it("returns items with base/tense/expected (+ optional alternates)", () => {
    const raw = JSON.stringify({
      items: [{ base: "食べる", tense: "past polite", expected: "食べました", alternates: ["たべました"] }],
    });
    const out = parseConjugationBatch(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.alternates).toEqual(["たべました"]);
  });
  it("alternates is optional", () => {
    const raw = JSON.stringify({
      items: [{ base: "食べる", tense: "past polite", expected: "食べました" }],
    });
    expect(parseConjugationBatch(raw)[0]!.alternates).toBeUndefined();
  });
  it("throws when expected is missing", () => {
    expect(() => parseConjugationBatch(JSON.stringify({
      items: [{ base: "食べる", tense: "past polite" }],
    }))).toThrow();
  });
  it("throws when alternates is not a string array", () => {
    expect(() => parseConjugationBatch(JSON.stringify({
      items: [{ base: "x", tense: "y", expected: "z", alternates: [1,2,3] }],
    }))).toThrow();
  });
  it("strips fences", () => {
    const inner = JSON.stringify({ items: [{ base: "x", tense: "y", expected: "z" }] });
    expect(parseConjugationBatch("```json\n" + inner + "\n```")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run + implement + run + commit**

Run: `npm --workspace gen test -- parse` → FAIL.

Append to `gen/src/parse.ts`:

```ts
export type ConjugationItem = {
  base: string;
  tense: string;
  expected: string;
  alternates?: string[];
};

export function parseConjugationBatch(raw: string): ConjugationItem[] {
  const parsed = JSON.parse(stripFences(raw));
  const items = parsed?.items;
  if (!Array.isArray(items)) throw new Error("response missing 'items' array");
  for (const it of items) {
    if (
      typeof it?.base !== "string" ||
      typeof it?.tense !== "string" ||
      typeof it?.expected !== "string"
    ) {
      throw new Error("conjugation item missing required fields");
    }
    if (it.alternates !== undefined) {
      if (!Array.isArray(it.alternates) || it.alternates.some((a: unknown) => typeof a !== "string")) {
        throw new Error("conjugation item has invalid alternates");
      }
    }
  }
  return items as ConjugationItem[];
}
```

Run: `npm --workspace gen test` → PASS.

```bash
git add gen/src/parse.ts gen/src/parse.test.ts
git commit -m "feat(gen): conjugation parser"
```

---

### Task 5: `generateConjugationBatch` + fake fixture

**Files:**
- Modify: `gen/src/generate.ts`
- Modify: `gen/src/generate.test.ts`
- Modify: `gen/src/index.ts`

- [ ] **Step 1: Failing test**

Append:

```ts
import { generateConjugationBatch } from "./generate.js";

describe("generateConjugationBatch", () => {
  it("returns parsed conjugation items from the SDK", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ items: [
        { base: "食べる", tense: "past polite", expected: "食べました" },
      ]})}],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const r = await generateConjugationBatch({ count: 1, client: { messages: { create } } as never });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.expected).toBe("食べました");
  });
  it("returns fake fixture under NIHONGO_FAKE_AI=1", async () => {
    const prev = process.env.NIHONGO_FAKE_AI;
    process.env.NIHONGO_FAKE_AI = "1";
    try {
      const r = await generateConjugationBatch({ count: 2 });
      expect(r.items).toHaveLength(2);
    } finally {
      if (prev === undefined) delete process.env.NIHONGO_FAKE_AI;
      else process.env.NIHONGO_FAKE_AI = prev;
    }
  });
});
```

- [ ] **Step 2: Run + implement**

Run: `npm --workspace gen test` → FAIL.

In `gen/src/generate.ts`, add imports:

```ts
import { buildConjugationPrompt } from "./prompt.js";
import { parseConjugationBatch, type ConjugationItem } from "./parse.js";
```

Add `ConjugationItem` to the existing `export type { ... }` re-export line.

Add the fixture:

```ts
const CONJUGATION_FAKE: ConjugationItem[] = [
  { base: "食べる", tense: "past polite", expected: "食べました", alternates: ["たべました"] },
  { base: "行く", tense: "te-form", expected: "行って", alternates: ["いって"] },
  { base: "見る", tense: "negative polite", expected: "見ません", alternates: ["みません"] },
];
```

Add the generator:

```ts
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
```

Update `gen/src/index.ts` re-exports — add `parseConjugationBatch`, `type ConjugationItem`, `buildConjugationPrompt`, and `generateConjugationBatch`.

- [ ] **Step 3: Run + commit**

Run: `npm --workspace gen test` → PASS.

```bash
git add gen/src/generate.ts gen/src/generate.test.ts gen/src/index.ts
git commit -m "feat(gen): generateConjugationBatch + fake fixture"
```

---

### Task 6: Extend `runGeneration` for conjugation

**Files:**
- Modify: `server/src/services/generate.ts`
- Modify: `server/src/services/generate.test.ts`

- [ ] **Step 1: Test**

Append to `server/src/services/generate.test.ts`:

```ts
describe("runGeneration conjugation", () => {
  it("inserts conjugation items with base/base_ruby/tense/expected/expected_ruby", async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: JSON.stringify({ items: [
            { base: "食べる", tense: "past polite", expected: "食べました", alternates: ["たべました"] },
          ]})}],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      },
    };
    const r = await runGeneration({ skill: "conjugation", count: 1, client });
    expect(r.status).toBe("success");

    const items = await pool.query("SELECT skill, prompt, answer FROM items");
    expect(items.rows[0].skill).toBe("conjugation");
    expect(items.rows[0].prompt.base).toBe("食べる");
    expect(items.rows[0].prompt.base_ruby).toContain("<ruby>");
    expect(items.rows[0].prompt.tense).toBe("past polite");
    expect(items.rows[0].answer.expected).toBe("食べました");
    expect(items.rows[0].answer.expected_ruby).toContain("<ruby>");
    expect(items.rows[0].answer.alternates).toEqual(["たべました"]);
  });
});
```

- [ ] **Step 2: Update dispatcher**

In `server/src/services/generate.ts`:

Update imports:
```ts
import {
  generateVocabBatch, generateGrammarBatch, generateParticleBatch, generateConjugationBatch,
  toRubyHtml, readingFor, computeCost, GenerateError, MODEL,
  type Usage, type VocabItem, type GrammarItem, type ParticleItem, type ConjugationItem,
} from "@nihongo/gen";
```

Add to `genFor`:
```ts
case "conjugation": return await generateConjugationBatch(args);
```

Add to `enrichFor`:
```ts
case "conjugation": {
  const it = raw as ConjugationItem;
  const base_ruby = await toRubyHtml(it.base);
  const expected_ruby = await toRubyHtml(it.expected);
  return {
    prompt: { base: it.base, base_ruby, tense: it.tense },
    answer: { expected: it.expected, expected_ruby, alternates: it.alternates },
  };
}
```

- [ ] **Step 3: Run + commit**

Run: `set -a; source .env; set +a; npm --workspace server test`
Expected: PASS.

```bash
git add server/src/services/generate.ts server/src/services/generate.test.ts
git commit -m "feat(server): runGeneration handles conjugation"
```

---

### Task 7: Client `normalizeKana` helper

**Files:**
- Create: `client/src/lib/kana.ts`
- Optional: `client/src/lib/kana.test.ts` (see step 4)

- [ ] **Step 1: Write the helper**

Write `client/src/lib/kana.ts`:

```ts
// Normalize user input for conjugation grading.
//   - Trim whitespace
//   - NFKC normalize (collapses fullwidth digits/letters, harmonizes compatibility chars)
//   - Convert katakana to hiragana
// We do NOT romaji→kana; users are expected to use a Japanese IME.

const KATAKANA_TO_HIRAGANA = (s: string): string =>
  s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

export function normalizeKana(input: string): string {
  return KATAKANA_TO_HIRAGANA(input.normalize("NFKC").trim());
}

export function answerMatches(given: string, expected: string, alternates: readonly string[] = []): boolean {
  const g = normalizeKana(given);
  if (g.length === 0) return false;
  if (normalizeKana(expected) === g) return true;
  return alternates.some((a) => normalizeKana(a) === g);
}
```

- [ ] **Step 2: Verify client build**

Run: `npm --workspace client run build`
Expected: PASS.

- [ ] **Step 3: (Optional) Add vitest to client**

Skip for now — coverage comes from the e2e flow.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/kana.ts
git commit -m "feat(client): normalizeKana + answerMatches helpers"
```

---

### Task 8: `submitReview` accepts `answer_given`

**Files:**
- Modify: `client/src/api-hooks.ts`
- Modify: `server/src/routes/reviews.ts`
- Modify: `server/src/routes/reviews.test.ts`

- [ ] **Step 1: Update client hook**

Find the `submitReview` function and replace:

```ts
export function submitReview(input: {
  item_id: string;
  result: ReviewResult;
  reviewed_at: string;
  session_id?: string;
  answer_given?: string;
}): Promise<ReviewStateResponse> {
  return api<ReviewStateResponse>("/api/reviews", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
```

- [ ] **Step 2: Update server route**

In `server/src/routes/reviews.ts`, replace the zod body and downstream parsed destructure:

```ts
const Body = z.object({
  item_id: z.string().uuid(),
  result: z.enum(["got_it", "missed"]),
  reviewed_at: z.string().datetime(),
  session_id: z.string().uuid().optional(),
  answer_given: z.string().max(200).optional(),
});
```

Then where `{ item_id, result, reviewed_at, session_id }` is destructured, add `answer_given`:

```ts
const { item_id, result, reviewed_at, session_id, answer_given } = parsed.data;
```

And update the INSERT into `reviews` to include the new column:

```ts
await client.query(
  `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after, session_id, answer_given)
   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
  [item_id, reviewed_at, result, prev?.box ?? 0, next.box, session_id ?? null, answer_given ?? null],
);
```

- [ ] **Step 3: Test it persists**

Append to `server/src/routes/reviews.test.ts`:

```ts
it("persists answer_given when provided", async () => {
  const itemId = await insertItem();
  await request(app).post("/api/reviews").set("X-Passcode", PASSCODE)
    .send({ item_id: itemId, result: "got_it", reviewed_at: new Date().toISOString(), answer_given: "食べました" });
  const r = await pool.query(`SELECT answer_given FROM reviews WHERE item_id = $1`, [itemId]);
  expect(r.rows[0].answer_given).toBe("食べました");
});
```

- [ ] **Step 4: Run + commit**

Run: `set -a; source .env; set +a; npm --workspace server test -- routes/reviews`
Expected: PASS.

```bash
git add client/src/api-hooks.ts server/src/routes/reviews.ts server/src/routes/reviews.test.ts
git commit -m "feat: reviews accept answer_given for conjugation forensics"
```

---

### Task 9: Build `<TypedInputCard>`

**Files:**
- Create: `client/src/components/TypedInputCard.tsx`
- Modify: `client/src/styles/cards.css`

- [ ] **Step 1: Create the component**

Write `client/src/components/TypedInputCard.tsx`:

```tsx
import { useState, useRef, useEffect } from "react";
import type { ItemRecord, ConjugationPrompt, ConjugationAnswer, ReviewResult } from "@nihongo/shared";
import { RubyText } from "./RubyText";
import { answerMatches, normalizeKana } from "../lib/kana";

type Props = {
  item: ItemRecord;
  onAnswer: (result: ReviewResult, answer_given?: string) => void;
};

export function TypedInputCard({ item, onAnswer }: Props) {
  const prompt = item.prompt as ConjugationPrompt;
  const answer = item.answer as ConjugationAnswer;
  const [value, setValue] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const autoCorrect = submitted && answerMatches(value, answer.expected, answer.alternates ?? []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  function grade(result: ReviewResult) {
    onAnswer(result, normalizeKana(value));
  }

  return (
    <div className="typed-card">
      <div className="typed-card__prompt">
        <RubyText html={prompt.base_ruby} className="typed-card__base" />
        <span className="typed-card__tense">{prompt.tense}</span>
      </div>

      {!submitted ? (
        <form onSubmit={submit} className="typed-card__form">
          <input
            ref={inputRef}
            type="text"
            inputMode="text"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Type the conjugated form"
            className="typed-card__input"
          />
          <button type="submit" className="typed-card__submit">Submit</button>
        </form>
      ) : (
        <div className="typed-card__reveal">
          <p className={`typed-card__feedback ${autoCorrect ? "is-correct" : "is-wrong"}`}>
            {autoCorrect ? "Correct" : "Not quite"} — expected:
          </p>
          <RubyText html={answer.expected_ruby} className="typed-card__expected" />
          {answer.alternates && answer.alternates.length > 0 && (
            <p className="typed-card__alternates muted">
              also accepted: {answer.alternates.join(" · ")}
            </p>
          )}
          <div className="typed-card__grade">
            <button type="button" className="flipcard__btn flipcard__btn--missed" onClick={() => grade("missed")}>
              Missed
            </button>
            <button type="button" className="flipcard__btn flipcard__btn--got" onClick={() => grade("got_it")}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add styles**

Append to `client/src/styles/cards.css`:

```css
/* TypedInputCard (conjugation skill) */
.typed-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
}

.typed-card__prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.typed-card__base {
  font-family: var(--font-display);
  font-size: var(--font-size-7);
}

.typed-card__tense {
  display: inline-block;
  padding: var(--space-1) var(--space-3);
  background: var(--color-accent-muted);
  color: var(--color-accent);
  border-radius: var(--radius-md);
  font-family: var(--font-ui);
  font-size: var(--font-size-2);
}

.typed-card__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.typed-card__input {
  padding: var(--space-3);
  background: var(--color-bg-raised);
  color: var(--color-fg);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  font-family: var(--font-display);
  font-size: var(--font-size-5);
  text-align: center;
}

.typed-card__input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-glow);
}

.typed-card__submit {
  min-height: 52px;
  background: var(--color-accent);
  color: #fff;
  font-family: var(--font-ui);
  font-size: var(--font-size-3);
  font-weight: var(--font-weight-medium);
  border: none;
  border-radius: var(--radius-lg);
  cursor: pointer;
}

.typed-card__reveal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  text-align: center;
}

.typed-card__feedback.is-correct { color: var(--color-success); }
.typed-card__feedback.is-wrong { color: var(--color-error); }

.typed-card__expected {
  font-family: var(--font-display);
  font-size: var(--font-size-6);
}

.typed-card__alternates {
  font-family: var(--font-ui);
  font-size: var(--font-size-2);
}

.typed-card__grade {
  display: flex;
  gap: var(--space-3);
  width: 100%;
}
```

- [ ] **Step 3: Verify build**

Run: `npm --workspace client run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/TypedInputCard.tsx client/src/styles/cards.css
git commit -m "feat(client): TypedInputCard for conjugation skill"
```

---

### Task 10: PracticeScreen dispatches conjugation; passes `answer_given`

**Files:**
- Modify: `client/src/screens/PracticeScreen.tsx`

- [ ] **Step 1: Update handleAnswer + dispatch**

Modify the JSX dispatch block:

```tsx
{current.skill === "particle" ? (
  <MultipleChoiceCard key={current.id} item={current} onAnswer={handleAnswer} />
) : current.skill === "conjugation" ? (
  <TypedInputCard key={current.id} item={current} onAnswer={handleAnswerWithText} />
) : (
  <FlipCard key={current.id} item={current} onAnswer={handleAnswer} />
)}
```

Add the import:

```tsx
import { TypedInputCard } from "../components/TypedInputCard";
```

Update the answer-handling functions. Replace the existing `handleAnswer` with two functions:

```tsx
function handleAnswer(result: ReviewResult) {
  handleAnswerWithText(result);
}

function handleAnswerWithText(result: ReviewResult, answer_given?: string) {
  const item = items[index];
  if (!item) return;
  setCounts((c) => result === "got_it" ? { ...c, got: c.got + 1 } : { ...c, missed: c.missed + 1 });
  const reviewedAt = new Date().toISOString();
  void retryingSubmit({
    item_id: item.id,
    result,
    reviewed_at: reviewedAt,
    session_id: sessionIdRef.current ?? undefined,
    answer_given,
  });
  if (index + 1 >= items.length) {
    void finishSession();
  } else {
    setIndex(index + 1);
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm --workspace client run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/screens/PracticeScreen.tsx
git commit -m "feat(client): PracticeScreen dispatches conjugation to TypedInputCard (with answer_given)"
```

---

### Task 11: Enable Conjugation on the dashboard

**Files:**
- Modify: `client/src/screens/DashboardScreen.tsx`

- [ ] **Step 1: Update AVAILABLE**

```ts
const AVAILABLE: Skill[] = ["vocab", "grammar", "particle", "conjugation"];
```

- [ ] **Step 2: Verify + commit**

Run: `npm --workspace client run build`
Expected: PASS.

```bash
git add client/src/screens/DashboardScreen.tsx
git commit -m "feat(client): enable Conjugation card on dashboard"
```

---

### Task 12: E2E conjugation

**Files:**
- Create: `e2e/tests/conjugation.spec.ts`

- [ ] **Step 1: Write the spec**

Write `e2e/tests/conjugation.spec.ts`:

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

test("conjugation: generate → type answer → auto-grade + override", async ({ page }) => {
  await login(page);

  const card = page.locator(".skill-card--conjugation");
  await card.getByRole("button", { name: /Generate/i }).click();
  // CONJUGATION_FAKE has 3 items; default count for conjugation is 5, slice clamps to 3
  await expect(card.locator(".skill-card__count")).toContainText("3", { timeout: 10_000 });

  await card.getByRole("button", { name: /Practice/i }).click();
  // The first fixture item is { base: 食べる, tense: past polite, expected: 食べました }
  const input = page.locator(".typed-card__input");
  await expect(input).toBeVisible();

  // Type the expected form
  await input.fill("食べました");
  await page.getByRole("button", { name: /Submit/i }).click();

  await expect(page.locator(".typed-card__feedback.is-correct")).toBeVisible();
  await page.getByRole("button", { name: /Got it/i }).click();
  // Either next card prompt or summary
  await expect(page.locator(".practice__progress, h1:has-text('Done'), .typed-card__base")).toBeVisible();
});
```

- [ ] **Step 2: Run + commit**

`npm run dev:e2e` + `npm run e2e`.
Expected: smoke + generate + grammar + particle + conjugation all pass.

```bash
git add e2e/tests/conjugation.spec.ts
git commit -m "test(e2e): conjugation generate + type + override scenario"
```

---

### Task 13: Manual smoke

- [ ] Run migration on prod: deploy via `bash scripts/deploy.sh` (deploy already includes `npm --workspace server run db:migrate`)
- [ ] Open the app, log in
- [ ] Dashboard now shows Conjugation as available
- [ ] Generate 5 → practice → type some conjugations (including a known alternate like kana-only); verify auto-grade works for matches and self-override works for misses
- [ ] `psql -c "SELECT answer_given, result FROM reviews WHERE answer_given IS NOT NULL ORDER BY reviewed_at DESC LIMIT 5;"` — confirm typed answers are stored

---

## Self-review

- [x] Migration in Task 1; column added; deploy script picks it up
- [x] `answer_given` flows: client input → `normalizeKana` → submitReview body → server zod validates → DB INSERT
- [x] Auto-grade in TypedInputCard uses `answerMatches` (expected + alternates with normalization)
- [x] Self-override always wins for SRS state (clicking "Got it" / "Missed" sets the result)
- [x] No placeholders

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-05-16-phase-2-3-conjugation.md`.
