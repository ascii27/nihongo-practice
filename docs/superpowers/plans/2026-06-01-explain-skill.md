# `explain` (説明) Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sixth practice skill, `explain`, that presents a real-world task + required connectives + target register, accepts a free-text 2–4 sentence Japanese answer, and grades it with an LLM rubric (the first skill needing an LLM call on the review path).

**Architecture:** Follow the existing per-skill pattern exactly — `gen` owns LLM-call + parse (generation *and* grading), `server` enriches parsed output into the stored `{prompt, answer}` jsonb and wires HTTP. Generation mirrors the other five batch generators. Grading is a new pure-scoring endpoint `POST /api/explain/grade` that loads the item, calls the LLM, returns an `ExplainGrade` + a `got_it`/`missed` mapping, and writes nothing — the client then records the review through the untouched `POST /api/reviews` path (preserving its idempotency model). For MVP the learner's attempt is truncated into the existing `reviews.answer_given` column.

**Tech Stack:** TypeScript, pnpm workspaces (`shared`/`gen`/`server`/`client`/`e2e`), Zod, Express, Postgres (node-pg-migrate, raw SQL), React + Vite, Vitest, Playwright, Anthropic SDK, kuromoji-based `toRubyHtml`.

---

## File Structure

**Create:**
- `db/migrations/1780358400000_items_skill_explain.sql` — widen the `items.skill` CHECK constraint to allow `'explain'`.
- `server/src/services/grade-explanation.ts` — `gradeExplanation({ item_id })`-style service: loads item, calls gen grader, enriches `corrected_ruby`, maps to `got_it`/`missed`.
- `server/src/routes/explain.ts` — `POST /api/explain/grade`.
- `server/src/routes/explain.test.ts` — route tests.
- `client/src/components/ProductionCard.tsx` — the explain practice card.
- `e2e/tests/explain.spec.ts` — end-to-end.

**Modify:**
- `shared/src/types.ts` — `Skill` enum; `ExplainPrompt`/`ExplainAnswer`/`ExplainGrade`; grade request/response types; add `explain` to `DashboardResponse.by_skill`, `StatsBySkillResponse.by_skill`, `LibraryResponse.by_skill`.
- `gen/src/parse.ts` — `ExplainItem` + `parseExplainBatch`; `ExplainGradeRaw` + `parseExplainGrade`.
- `gen/src/prompt.ts` — `EXPLAIN_SYSTEM` + `buildExplainPrompt`; `EXPLAIN_GRADE_SYSTEM` + `buildExplainGradePrompt`.
- `gen/src/generate.ts` — `EXPLAIN_FAKE` + `generateExplainBatch`; `gradeExplanationRaw` + fake.
- `gen/src/index.ts` — export the new gen symbols.
- `gen/src/parse.test.ts` — `parseExplainBatch` / `parseExplainGrade` unit tests.
- `server/src/services/generate.ts` — `genFor` + `enrichFor` `explain` cases.
- `server/src/services/generate.test.ts` — explain generation test.
- `server/src/index.ts` — mount `explainRouter`.
- `server/src/routes/dashboard.ts`, `server/src/routes/stats.ts`, `server/src/routes/library.ts` — add `"explain"` to each `SKILLS` array.
- `client/src/lib/skills.ts` — `SKILL_ORDER` + `SKILL_META`.
- `client/src/components/GenerateForm.tsx` — add `explain` to `SKILL_LABELS`.
- `client/src/api-hooks.ts` — `gradeExplanation` client fn.
- `client/src/screens/PracticeScreen.tsx` — route `explain` → `ProductionCard`.

---

## Conventions (read before starting)

**This is an npm workspace (not pnpm). Commands below — the plan's task steps may say `pnpm`; use these npm equivalents instead:**

- Build all: `npm run build` (root; builds shared → server → client). Per-package: `npm --workspace @nihongo/<pkg> run build`. Note `@nihongo/server` "build" is `tsc -p tsconfig.json --noEmit` (typecheck only); `@nihongo/client` build is Vite + tsc.
- Test a package: `npm --workspace <pkg> test` where `<pkg>` is `gen`, `server`, `shared`, `seed`, or `e2e`. Filter to a file with `-- <pattern>`, e.g. `npm --workspace server test -- routes/explain`.
- **Server, seed, and shared(DB) tests + migrations need env vars loaded from `.env`.** There is no dotenv loader — prefix the command by sourcing it:
  `set -a; . ./.env; set +a` then run the test/migrate. (`DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo`; Postgres already runs via `npm run db:up` / docker.) The `gen` and `shared` non-DB tests do not need env.
- Migrations: `set -a; . ./.env; set +a; npm run db:migrate` (runs `tsx src/db/migrate.ts up`).
- `NIHONGO_FAKE_AI=1` returns canned fixtures from gen. For route tests that exercise an LLM path over HTTP (can't inject a client), set it in `beforeEach` exactly like `server/src/routes/generate.test.ts` does: `beforeEach(async () => { await resetDb(); process.env.NIHONGO_FAKE_AI = "1"; })`. **Do not** modify `server/vitest.config.ts`.
- Gen/server service functions accept an injectable `client?: ClientLike` so unit tests pass a fake `{ messages: { create: vi.fn() } }` and avoid the env flag.
- Express passcode auth is applied globally (`app.use("/api", passcodeMiddleware(env.PASSCODE))` in `server/src/index.ts:25`); individual routers do NOT wrap it. Mount the new router with `app.use("/api/explain", explainRouter)` immediately after the items router (line ~33).
- `toRubyHtml(jaText)` returns furigana HTML (`<ruby>…<rt>…</rt></ruby>`). It is async.
- All cross-package imports use the `.js` extension in source (ESM) even for `.ts` files.
- Commit after each task with a `feat:`/`test:` Conventional Commit message.

---

## Task 1: Migration — widen `items.skill` CHECK

**Files:**
- Create: `db/migrations/1780358400000_items_skill_explain.sql`

The current constraint (unnamed inline CHECK in `db/migrations/1746460800000_phase1_tables.sql:7`) is auto-named `items_skill_check` by Postgres and only allows the five existing skills. Inserting an `explain` item fails until this is widened.

- [ ] **Step 1: Write the migration SQL**

```sql
-- 1780358400000_items_skill_explain.sql
-- Phase: add the `explain` skill. Widen the items.skill CHECK so the sixth
-- skill can be stored. The original constraint was an unnamed inline CHECK,
-- which Postgres named items_skill_check.
ALTER TABLE items DROP CONSTRAINT items_skill_check;
ALTER TABLE items ADD CONSTRAINT items_skill_check
  CHECK (skill IN ('vocab','grammar','reading','conjugation','particle','explain'));
```

- [ ] **Step 2: Run the migration against the dev/test DB**

Run: `pnpm --filter @nihongo/server migrate` (or the repo's documented migrate command — check `server/package.json` scripts for the exact name).
Expected: migration `1780358400000_items_skill_explain` applied, no error. If the constraint name differs, find it with:
`psql "$DATABASE_URL" -c "\d items"` and adjust the `DROP CONSTRAINT` name.

- [ ] **Step 3: Verify an explain insert is now accepted**

Run: `psql "$DATABASE_URL" -c "INSERT INTO items (skill, prompt, answer, source, external_id) VALUES ('explain','{}','{}','ai','probe-1'); DELETE FROM items WHERE external_id='probe-1';"`
Expected: `INSERT 0 1` then `DELETE 1`, no constraint violation.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/1780358400000_items_skill_explain.sql
git commit -m "feat(db): allow 'explain' skill in items.skill check"
```

---

## Task 2: Shared types — `Skill` enum + Explain shapes + exhaustive Records

**Files:**
- Modify: `shared/src/types.ts`

- [ ] **Step 1: Add `explain` to the `Skill` enum**

In `shared/src/types.ts`, change the `Skill` definition (line ~27):

```ts
export const Skill = z.enum(["vocab", "grammar", "reading", "conjugation", "particle", "explain"]);
export type Skill = z.infer<typeof Skill>;
```

- [ ] **Step 2: Add the Explain prompt/answer/grade shapes**

Add after the `ReadingAnswer` block (after line ~208), keeping the per-skill grouping:

```ts
// explain — free-text productive explanation, LLM-graded on a rubric

export const ExplainPrompt = z.object({
  task_english: z.string(),
  task_japanese_ruby: z.string().optional(),
  required_connectives: z.array(z.string()),   // e.g. ["つまり","その結果","一方で"]
  register: z.enum(["casual", "polite", "formal"]),
});
export type ExplainPrompt = z.infer<typeof ExplainPrompt>;

export const ExplainAnswer = z.object({
  model_explanation_ruby: z.string(),          // reference answer, furigana HTML
  rubric_notes: z.string(),                    // what a strong answer should contain
});
export type ExplainAnswer = z.infer<typeof ExplainAnswer>;

export const ExplainGrade = z.object({
  connective_use: z.number().min(0).max(1),
  structure: z.number().min(0).max(1),
  register: z.number().min(0).max(1),
  grammar: z.number().min(0).max(1),
  overall: z.number().min(0).max(1),
  corrected_ruby: z.string(),                  // furigana HTML
  feedback: z.string(),                        // 1–2 sentences
});
export type ExplainGrade = z.infer<typeof ExplainGrade>;

// POST /api/explain/grade — pure scoring, no DB write. Client records the
// review afterward via POST /api/reviews (idempotency model untouched).
export const ExplainGradeRequest = z.object({
  item_id: z.string().uuid(),
  answer_given: z.string().min(1).max(2000),
});
export type ExplainGradeRequest = z.infer<typeof ExplainGradeRequest>;

export const ExplainGradeResponse = z.object({
  grade: ExplainGrade,
  result: ReviewResult,                        // overall >= 0.6 → got_it
  cost_usd: z.number().nonnegative(),
});
export type ExplainGradeResponse = z.infer<typeof ExplainGradeResponse>;
```

`ReviewResult` is already defined earlier in the file (line ~70), so it is in scope.

- [ ] **Step 3: Add `explain` to the three exhaustive `by_skill` Records**

`DashboardResponse.by_skill` (line ~221) — add the key:

```ts
  by_skill: z.object({
    vocab: SkillCounts,
    grammar: SkillCounts,
    reading: SkillCounts,
    conjugation: SkillCounts,
    particle: SkillCounts,
    explain: SkillCounts,
  }),
```

`StatsBySkillResponse.by_skill` (line ~240):

```ts
  by_skill: z.object({
    vocab: SkillStats,
    grammar: SkillStats,
    reading: SkillStats,
    conjugation: SkillStats,
    particle: SkillStats,
    explain: SkillStats,
  }),
```

`LibraryResponse.by_skill` (line ~272):

```ts
  by_skill: z.object({
    vocab: LibrarySkillGroup,
    grammar: LibrarySkillGroup,
    reading: LibrarySkillGroup,
    conjugation: LibrarySkillGroup,
    particle: LibrarySkillGroup,
    explain: LibrarySkillGroup,
  }),
```

- [ ] **Step 4: Typecheck shared**

Run: `pnpm --filter @nihongo/shared build` (or `pnpm --filter @nihongo/shared exec tsc --noEmit`)
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat(types): add explain skill enum, prompt/answer/grade, grade endpoint types"
```

---

## Task 3: Client skill metadata

**Files:**
- Modify: `client/src/lib/skills.ts`

This is required early because `SKILL_META` is a `Record<Skill, …>` — adding the enum value makes it non-exhaustive and breaks the client typecheck.

- [ ] **Step 1: Add explain to `SKILL_ORDER` and `SKILL_META`**

```ts
import type { Skill } from "@nihongo/shared";

export const SKILL_ORDER: Skill[] = ["vocab", "grammar", "particle", "conjugation", "reading", "explain"];

// Display metadata per skill. `ja` is a 2-kanji name; `short` is the single
// kanji used in the round glyph chips on Today / Browse.
export const SKILL_META: Record<Skill, { label: string; ja: string; short: string }> = {
  vocab: { label: "Vocab", ja: "語彙", short: "語" },
  grammar: { label: "Grammar", ja: "文法", short: "文" },
  particle: { label: "Particles", ja: "助詞", short: "助" },
  conjugation: { label: "Conjugation", ja: "活用", short: "活" },
  reading: { label: "Reading", ja: "読解", short: "読" },
  explain: { label: "Explain", ja: "説明", short: "説" },
};
```

- [ ] **Step 2: Commit** (typecheck happens in Task 11; client won't fully build until `ProductionCard` exists)

```bash
git add client/src/lib/skills.ts
git commit -m "feat(client): register explain skill metadata"
```

---

## Task 4: gen — parse `explain` generation batch

**Files:**
- Modify: `gen/src/parse.ts`
- Test: `gen/src/parse.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `gen/src/parse.test.ts` (and add `parseExplainBatch` to the import on line 2):

```ts
describe("parseExplainBatch", () => {
  it("parses valid explain items", () => {
    const raw = JSON.stringify({ items: [
      {
        task_english: "Explain to a colleague why you migrated to TiDB.",
        task_japanese: "同僚に、TiDBへ移行する理由を説明してください。",
        required_connectives: ["つまり", "その結果", "一方で"],
        register: "polite",
        model_explanation_japanese: "まず結論として、TiDBに移行しました。その結果、拡張性が向上しました。",
        rubric_notes: "Should state conclusion first, then reasons.",
      },
    ]});
    const items = parseExplainBatch(raw);
    expect(items).toHaveLength(1);
    expect(items[0].register).toBe("polite");
    expect(items[0].required_connectives).toEqual(["つまり", "その結果", "一方で"]);
  });

  it("throws when register is invalid", () => {
    const raw = JSON.stringify({ items: [
      { task_english: "x", task_japanese: "x", required_connectives: [], register: "shouting",
        model_explanation_japanese: "x", rubric_notes: "x" },
    ]});
    expect(() => parseExplainBatch(raw)).toThrow();
  });

  it("throws when required_connectives is not a string array", () => {
    const raw = JSON.stringify({ items: [
      { task_english: "x", task_japanese: "x", required_connectives: [1, 2], register: "casual",
        model_explanation_japanese: "x", rubric_notes: "x" },
    ]});
    expect(() => parseExplainBatch(raw)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @nihongo/gen test -- parse`
Expected: FAIL — `parseExplainBatch is not a function`.

- [ ] **Step 3: Implement `ExplainItem` + `parseExplainBatch`**

Append to `gen/src/parse.ts`:

```ts
export type ExplainItem = {
  task_english: string;
  task_japanese: string;
  required_connectives: string[];
  register: "casual" | "polite" | "formal";
  model_explanation_japanese: string;
  rubric_notes: string;
};

const REGISTERS = ["casual", "polite", "formal"] as const;

export function parseExplainBatch(raw: string): ExplainItem[] {
  const parsed = JSON.parse(stripFences(raw));
  const items = parsed?.items;
  if (!Array.isArray(items)) throw new Error("response missing 'items' array");
  for (const it of items) {
    if (
      typeof it?.task_english !== "string" ||
      typeof it?.task_japanese !== "string" ||
      !Array.isArray(it?.required_connectives) ||
      it.required_connectives.some((c: unknown) => typeof c !== "string") ||
      typeof it?.register !== "string" ||
      !REGISTERS.includes(it.register) ||
      typeof it?.model_explanation_japanese !== "string" ||
      typeof it?.rubric_notes !== "string"
    ) {
      throw new Error("explain item missing or invalid required fields");
    }
  }
  return items as ExplainItem[];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @nihongo/gen test -- parse`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gen/src/parse.ts gen/src/parse.test.ts
git commit -m "feat(gen): parse explain generation batch"
```

---

## Task 5: gen — parse the explain grade response

**Files:**
- Modify: `gen/src/parse.ts`
- Test: `gen/src/parse.test.ts`

The grader returns a single object (like `parseManualVocab`), with four 0–1 dimensions + `overall` + `corrected_japanese` + `feedback`. `corrected_ruby` is produced server-side, so the gen layer parses `corrected_japanese`.

- [ ] **Step 1: Write the failing test**

Append to `gen/src/parse.test.ts` (add `parseExplainGrade` to the import on line 2):

```ts
describe("parseExplainGrade", () => {
  it("parses a valid grade", () => {
    const raw = JSON.stringify({
      connective_use: 0.8, structure: 0.7, register: 1.0, grammar: 0.9, overall: 0.82,
      corrected_japanese: "結論として、移行しました。", feedback: "Good structure.",
    });
    const g = parseExplainGrade(raw);
    expect(g.overall).toBeCloseTo(0.82);
    expect(g.corrected_japanese).toContain("移行");
  });

  it("clamps out-of-range scores into 0..1", () => {
    const raw = JSON.stringify({
      connective_use: 1.4, structure: -0.2, register: 0.5, grammar: 0.5, overall: 2,
      corrected_japanese: "x", feedback: "x",
    });
    const g = parseExplainGrade(raw);
    expect(g.connective_use).toBe(1);
    expect(g.structure).toBe(0);
    expect(g.overall).toBe(1);
  });

  it("throws when a score is missing", () => {
    const raw = JSON.stringify({ structure: 0.5, register: 0.5, grammar: 0.5, overall: 0.5,
      corrected_japanese: "x", feedback: "x" });
    expect(() => parseExplainGrade(raw)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @nihongo/gen test -- parse`
Expected: FAIL — `parseExplainGrade is not a function`.

- [ ] **Step 3: Implement `ExplainGradeRaw` + `parseExplainGrade`**

Append to `gen/src/parse.ts`:

```ts
export type ExplainGradeRaw = {
  connective_use: number;
  structure: number;
  register: number;
  grammar: number;
  overall: number;
  corrected_japanese: string;
  feedback: string;
};

function clamp01(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) throw new Error("score is not a number");
  return Math.max(0, Math.min(1, n));
}

export function parseExplainGrade(raw: string): ExplainGradeRaw {
  const p = JSON.parse(stripFences(raw));
  if (typeof p?.corrected_japanese !== "string" || typeof p?.feedback !== "string") {
    throw new Error("explain grade missing corrected_japanese/feedback");
  }
  return {
    connective_use: clamp01(p.connective_use),
    structure: clamp01(p.structure),
    register: clamp01(p.register),
    grammar: clamp01(p.grammar),
    overall: clamp01(p.overall),
    corrected_japanese: p.corrected_japanese,
    feedback: p.feedback,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @nihongo/gen test -- parse`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gen/src/parse.ts gen/src/parse.test.ts
git commit -m "feat(gen): parse explain grade response"
```

---

## Task 6: gen — prompts for generation and grading

**Files:**
- Modify: `gen/src/prompt.ts`

- [ ] **Step 1: Add `EXPLAIN_SYSTEM` + `buildExplainPrompt`**

Append to `gen/src/prompt.ts`:

```ts
const EXPLAIN_SYSTEM = `You generate Japanese productive-explanation drills for an intermediate-to-advanced learner who works in software (platform, reliability, planning). Each drill gives a real-world workplace task, a set of required connectives the learner must use, a target register, a model answer, and rubric notes.
Vary the task topic, the required connectives, and the register across the batch. Pick 2–4 required connectives per item from natural discourse connectives (e.g. つまり／その結果／一方で／なぜなら／したがって／例えば). The model answer must be 2–4 natural sentences following 結論→理由→具体例→まとめ and must actually use the required connectives in the chosen register.
Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "items": [ { "task_english": "<EN task>", "task_japanese": "<JA task prompt>", "required_connectives": ["<c1>","<c2>"], "register": "casual|polite|formal", "model_explanation_japanese": "<2–4 JA sentences>", "rubric_notes": "<what a strong answer contains, EN>" } ] }`;

export function buildExplainPrompt(args: { count: number; weakness_hint?: string }): PromptPair {
  const lines: string[] = [`Generate ${args.count} explanation drills.`];
  if (args.weakness_hint && args.weakness_hint.trim().length > 0) {
    lines.push(`Focus on: ${args.weakness_hint.trim()}`);
  } else {
    lines.push("Seed the tasks from real software-work topics: platform migrations, reliability/incidents, and planning.");
  }
  return { system: EXPLAIN_SYSTEM, user: lines.join("\n") };
}
```

- [ ] **Step 2: Add `EXPLAIN_GRADE_SYSTEM` + `buildExplainGradePrompt`**

Append to `gen/src/prompt.ts`:

```ts
const EXPLAIN_GRADE_SYSTEM = `You grade a Japanese learner's short explanation (2–4 sentences).
Inputs: the task, the required connectives, the target register, and the learner's text.
Score each 0.0–1.0: connective_use (required connectives present AND used correctly),
structure (結論→理由→具体例→まとめ progression), register (target register held throughout),
grammar (accuracy/naturalness). overall = weighted mean (connective_use and structure
weighted highest). Provide corrected_japanese (a natural rewrite preserving the learner's
intent) and feedback (1–2 sentences, concrete, English).
Reply ONLY with valid JSON, no prose, no fences:
{ "connective_use": n, "structure": n, "register": n, "grammar": n, "overall": n,
  "corrected_japanese": "<JA>", "feedback": "<EN>" }`;

export function buildExplainGradePrompt(args: {
  task_english: string;
  required_connectives: string[];
  register: string;
  answer_given: string;
}): PromptPair {
  const user = [
    `Task: ${args.task_english}`,
    `Required connectives: ${args.required_connectives.join(" / ") || "(none)"}`,
    `Target register: ${args.register}`,
    `Learner's answer:`,
    args.answer_given,
  ].join("\n");
  return { system: EXPLAIN_GRADE_SYSTEM, user };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @nihongo/gen build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add gen/src/prompt.ts
git commit -m "feat(gen): explain generation + grading prompts"
```

---

## Task 7: gen — `generateExplainBatch` + `gradeExplanationRaw` + exports

**Files:**
- Modify: `gen/src/generate.ts`
- Modify: `gen/src/index.ts`

- [ ] **Step 1: Wire imports in `generate.ts`**

In `gen/src/generate.ts`, add to the `./prompt.js` import block: `buildExplainPrompt, buildExplainGradePrompt`. Add to the `./parse.js` import block: `parseExplainBatch, parseExplainGrade, type ExplainItem, type ExplainGradeRaw`. Add `ExplainItem, ExplainGradeRaw` to the `export type { … }` re-export on line ~30.

- [ ] **Step 2: Add the fake fixtures**

Add near the other `*_FAKE` constants in `gen/src/generate.ts`:

```ts
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
```

- [ ] **Step 3: Add `generateExplainBatch`**

Add alongside the other batch generators in `gen/src/generate.ts`:

```ts
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
  const { system, user } = buildExplainPrompt({ count: args.count, weakness_hint: args.weakness_hint });
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<ExplainItem[]>({
    system, user, parse: parseExplainBatch, client, signal: args.signal,
  });
  return { items: value, usage, raw };
}
```

- [ ] **Step 4: Add `gradeExplanationRaw`**

Add to `gen/src/generate.ts` (mirrors `generateManualVocab` — single-object result):

```ts
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
```

- [ ] **Step 5: Export from `index.ts`**

In `gen/src/index.ts`, extend the existing export lines:

- Add to the `./parse.js` export: `parseExplainBatch, parseExplainGrade, type ExplainItem, type ExplainGradeRaw`.
- Add to the `./prompt.js` export: `buildExplainPrompt, buildExplainGradePrompt`.
- Add to the `./generate.js` export block: `generateExplainBatch, gradeExplanationRaw`.

- [ ] **Step 6: Build gen**

Run: `pnpm --filter @nihongo/gen build && pnpm --filter @nihongo/gen test`
Expected: PASS (parse tests from Tasks 4–5 still green; build clean).

- [ ] **Step 7: Commit**

```bash
git add gen/src/generate.ts gen/src/index.ts
git commit -m "feat(gen): generateExplainBatch + gradeExplanationRaw"
```

---

## Task 8: server — enrich explain items in generation

**Files:**
- Modify: `server/src/services/generate.ts`
- Test: `server/src/services/generate.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/src/services/generate.test.ts`:

```ts
describe("runGeneration explain", () => {
  it("inserts explain items with ruby-enriched task + model explanation", async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: JSON.stringify({ items: [
            {
              task_english: "Explain why you migrated to TiDB.",
              task_japanese: "TiDBへ移行した理由を説明してください。",
              required_connectives: ["つまり", "その結果"],
              register: "polite",
              model_explanation_japanese: "結論として移行しました。その結果、性能が向上しました。",
              rubric_notes: "Conclusion first.",
            },
          ]})}],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      },
    };
    const r = await runGeneration({ skill: "explain", count: 1, client });
    expect(r.status).toBe("success");
    expect(r.items_created).toBe(1);

    const items = await pool.query("SELECT skill, prompt, answer FROM items");
    expect(items.rows[0].skill).toBe("explain");
    expect(items.rows[0].prompt.task_english).toContain("TiDB");
    expect(items.rows[0].prompt.required_connectives).toEqual(["つまり", "その結果"]);
    expect(items.rows[0].prompt.register).toBe("polite");
    expect(items.rows[0].prompt.task_japanese_ruby).toContain("<ruby>");
    expect(items.rows[0].answer.model_explanation_ruby).toContain("<ruby>");
    expect(items.rows[0].answer.rubric_notes).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @nihongo/server test -- generate`
Expected: FAIL — `generation for skill='explain' not implemented yet`.

- [ ] **Step 3: Add imports**

In `server/src/services/generate.ts`, add `generateExplainBatch` to the `@nihongo/gen` import and `type ExplainItem` to the type imports.

- [ ] **Step 4: Add the `genFor` case**

In the `genFor` switch (line ~41), before `default:`:

```ts
    case "explain": return await generateExplainBatch(args);
```

- [ ] **Step 5: Add the `enrichFor` case**

In the `enrichFor` switch (line ~52), before `default:`:

```ts
    case "explain": {
      const it = raw as ExplainItem;
      const task_japanese_ruby = await toRubyHtml(it.task_japanese);
      const model_explanation_ruby = await toRubyHtml(it.model_explanation_japanese);
      return {
        prompt: {
          task_english: it.task_english,
          task_japanese_ruby,
          required_connectives: it.required_connectives,
          register: it.register,
        },
        answer: { model_explanation_ruby, rubric_notes: it.rubric_notes },
      };
    }
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @nihongo/server test -- generate`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/generate.ts server/src/services/generate.test.ts
git commit -m "feat(server): generate + enrich explain items"
```

---

## Task 9: server — `gradeExplanation` service + threshold mapping

**Files:**
- Create: `server/src/services/grade-explanation.ts`
- Test: `server/src/services/grade-explanation.test.ts`

This service loads the item, calls `gradeExplanationRaw`, runs `toRubyHtml` on `corrected_japanese` → `corrected_ruby`, and maps `overall` to `got_it`/`missed` at 0.6.

- [ ] **Step 1: Write the failing test**

Create `server/src/services/grade-explanation.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { gradeExplanation, gradeToResult } from "./grade-explanation.js";

beforeEach(() => resetDb());

async function insertExplainItem(): Promise<string> {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ('explain', $1, $2, 'ai', $3) RETURNING id`,
    [
      JSON.stringify({
        task_english: "Explain why you migrated to TiDB.",
        task_japanese_ruby: "<ruby>移行<rt>いこう</rt></ruby>",
        required_connectives: ["つまり", "その結果"],
        register: "polite",
      }),
      JSON.stringify({ model_explanation_ruby: "x", rubric_notes: "x" }),
      `e-${Math.random()}`,
    ],
  );
  return r.rows[0].id;
}

function fakeGradeClient(grade: Record<string, unknown>) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify(grade) }],
        usage: { input_tokens: 80, output_tokens: 40 },
      }),
    },
  };
}

describe("gradeToResult", () => {
  it("maps overall >= 0.6 to got_it and below to missed", () => {
    expect(gradeToResult(0.6)).toBe("got_it");
    expect(gradeToResult(0.59)).toBe("missed");
    expect(gradeToResult(1)).toBe("got_it");
  });
});

describe("gradeExplanation", () => {
  it("grades an item, enriches corrected_ruby, returns result + cost", async () => {
    const itemId = await insertExplainItem();
    const client = fakeGradeClient({
      connective_use: 0.8, structure: 0.7, register: 1, grammar: 0.9, overall: 0.82,
      corrected_japanese: "結論として、移行しました。", feedback: "Good.",
    });
    const r = await gradeExplanation({ item_id: itemId, answer_given: "移行しました。", client });
    expect(r.result).toBe("got_it");
    expect(r.grade.overall).toBeCloseTo(0.82);
    expect(r.grade.corrected_ruby).toContain("<ruby>");
    expect(r.cost_usd).toBeGreaterThan(0);
  });

  it("throws when the item does not exist", async () => {
    const client = fakeGradeClient({ connective_use: 1, structure: 1, register: 1, grammar: 1, overall: 1, corrected_japanese: "x", feedback: "x" });
    await expect(
      gradeExplanation({ item_id: "00000000-0000-0000-0000-000000000000", answer_given: "x", client }),
    ).rejects.toThrow();
  });

  it("throws when the item is not an explain item", async () => {
    const r = await pool.query(
      `INSERT INTO items (skill, prompt, answer, source, external_id)
       VALUES ('vocab', '{}', '{}', 'ai', $1) RETURNING id`, [`v-${Math.random()}`],
    );
    const client = fakeGradeClient({ connective_use: 1, structure: 1, register: 1, grammar: 1, overall: 1, corrected_japanese: "x", feedback: "x" });
    await expect(
      gradeExplanation({ item_id: r.rows[0].id, answer_given: "x", client }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @nihongo/server test -- grade-explanation`
Expected: FAIL — cannot find module `./grade-explanation.js`.

- [ ] **Step 3: Implement the service**

Create `server/src/services/grade-explanation.ts`:

```ts
import { gradeExplanationRaw, toRubyHtml, computeCost } from "@nihongo/gen";
import type { ExplainGrade, ExplainPrompt, ReviewResult } from "@nihongo/shared";
import { pool } from "../db/pool.js";

type AnthropicLike = { messages: { create: (body: unknown, opts?: { signal?: AbortSignal }) => Promise<unknown> } };

const PASS_THRESHOLD = 0.6;

export function gradeToResult(overall: number): ReviewResult {
  return overall >= PASS_THRESHOLD ? "got_it" : "missed";
}

export async function gradeExplanation(args: {
  item_id: string;
  answer_given: string;
  client?: AnthropicLike;
  signal?: AbortSignal;
}): Promise<{ grade: ExplainGrade; result: ReviewResult; cost_usd: number }> {
  const itemRes = await pool.query<{ skill: string; prompt: unknown }>(
    `SELECT skill, prompt FROM items WHERE id = $1`, [args.item_id],
  );
  if (itemRes.rowCount === 0) throw new Error("item not found");
  const row = itemRes.rows[0]!;
  if (row.skill !== "explain") throw new Error("item is not an explain item");
  const prompt = row.prompt as ExplainPrompt;

  const { grade: rawGrade, usage } = await gradeExplanationRaw({
    task_english: prompt.task_english,
    required_connectives: prompt.required_connectives,
    register: prompt.register,
    answer_given: args.answer_given,
    client: args.client,
    signal: args.signal,
  });

  const corrected_ruby = await toRubyHtml(rawGrade.corrected_japanese);
  const grade: ExplainGrade = {
    connective_use: rawGrade.connective_use,
    structure: rawGrade.structure,
    register: rawGrade.register,
    grammar: rawGrade.grammar,
    overall: rawGrade.overall,
    corrected_ruby,
    feedback: rawGrade.feedback,
  };
  return { grade, result: gradeToResult(grade.overall), cost_usd: computeCost(usage) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @nihongo/server test -- grade-explanation`
Expected: PASS (all 5 assertions across the three describe blocks).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/grade-explanation.ts server/src/services/grade-explanation.test.ts
git commit -m "feat(server): gradeExplanation service with 0.6 got_it/missed threshold"
```

---

## Task 10: server — `POST /api/explain/grade` route + mount

**Files:**
- Create: `server/src/routes/explain.ts`
- Create: `server/src/routes/explain.test.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/routes/explain.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { explainRouter } from "./explain.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/explain", explainRouter));

beforeEach(async () => {
  await resetDb();
  process.env.NIHONGO_FAKE_AI = "1";
});

async function insertExplainItem(): Promise<string> {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ('explain', $1, $2, 'ai', $3) RETURNING id`,
    [
      JSON.stringify({ task_english: "Explain X.", task_japanese_ruby: "<ruby>説明<rt>せつめい</rt></ruby>", required_connectives: ["つまり"], register: "polite" }),
      JSON.stringify({ model_explanation_ruby: "x", rubric_notes: "x" }),
      `e-${Math.random()}`,
    ],
  );
  return r.rows[0].id;
}

describe("POST /api/explain/grade", () => {
  // These tests rely on NIHONGO_FAKE_AI=1 (set in the server vitest setup) so
  // gradeExplanationRaw returns the deterministic passing fixture.
  it("grades a valid attempt and maps to got_it", async () => {
    const itemId = await insertExplainItem();
    const res = await request(app)
      .post("/api/explain/grade")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, answer_given: "結論として移行しました。その結果、改善しました。" });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("got_it");
    expect(res.body.grade.corrected_ruby).toContain("<ruby>");
    expect(typeof res.body.cost_usd).toBe("number");
  });

  it("400s on invalid body", async () => {
    const res = await request(app)
      .post("/api/explain/grade")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: "not-a-uuid", answer_given: "" });
    expect(res.status).toBe(400);
  });

  it("404s when item is missing", async () => {
    const res = await request(app)
      .post("/api/explain/grade")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: "00000000-0000-0000-0000-000000000000", answer_given: "x" });
    expect(res.status).toBe(404);
  });
});
```

Set `NIHONGO_FAKE_AI=1` in `beforeEach` (mirroring `server/src/routes/generate.test.ts`): `beforeEach(async () => { await resetDb(); process.env.NIHONGO_FAKE_AI = "1"; })`. Do NOT modify `server/vitest.config.ts`. The test above already shows this in its `beforeEach` — keep it.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @nihongo/server test -- routes/explain`
Expected: FAIL — cannot find module `./explain.js`.

- [ ] **Step 3: Implement the route**

Create `server/src/routes/explain.ts`:

```ts
import { Router } from "express";
import { ExplainGradeRequest } from "@nihongo/shared";
import { gradeExplanation } from "../services/grade-explanation.js";

export const explainRouter = Router();

const GRADE_TIMEOUT_MS = 60_000;

// POST /api/explain/grade — pure scoring, no DB write. The client records the
// review afterward through POST /api/reviews so the idempotency model is
// untouched. Grading failures surface as 502 with a clear message.
explainRouter.post("/grade", async (req, res) => {
  const parsed = ExplainGradeRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "invalid input", code: "INVALID_INPUT" });
    return;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GRADE_TIMEOUT_MS);
  try {
    const r = await gradeExplanation({
      item_id: parsed.data.item_id,
      answer_given: parsed.data.answer_given,
      signal: ac.signal,
    });
    res.json({ grade: r.grade, result: r.result, cost_usd: r.cost_usd });
  } catch (err) {
    const message = err instanceof Error ? err.message : "grade failed";
    if (message === "item not found") {
      res.status(404).json({ error: message, code: "ITEM_NOT_FOUND" });
      return;
    }
    if (message === "item is not an explain item") {
      res.status(400).json({ error: message, code: "WRONG_SKILL" });
      return;
    }
    res.status(502).json({ error: message, code: "GRADE_FAILED" });
  } finally {
    clearTimeout(timer);
  }
});
```

- [ ] **Step 4: Mount the router**

In `server/src/index.ts`, import and mount it next to the other routers (match the existing `app.use("/api/...", ...)` style). Find the items router mount and add below it:

```ts
import { explainRouter } from "./routes/explain.js";
// …
app.use("/api/explain", explainRouter);
```

Check the existing mounts first with `grep -n "app.use(\"/api" server/src/index.ts` and place it adjacent, with the same passcode middleware wrapper the others use.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @nihongo/server test -- routes/explain`
Expected: PASS (got_it, 400, 404).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/explain.ts server/src/routes/explain.test.ts server/src/index.ts server/vitest.config.ts
git commit -m "feat(server): POST /api/explain/grade endpoint"
```

---

## Task 11: server — add explain to dashboard/stats/library SKILLS arrays

**Files:**
- Modify: `server/src/routes/dashboard.ts:5`
- Modify: `server/src/routes/stats.ts:8`
- Modify: `server/src/routes/library.ts:7`

Each route builds `by_skill` by iterating a runtime `SKILLS` array. The zod response schemas (Task 2) now require an `explain` key, so each array must include it or the response will be missing a key the client type expects.

- [ ] **Step 1: Update all three arrays**

In each file change:

```ts
const SKILLS = ["vocab", "grammar", "reading", "conjugation", "particle"] as const;
```

to:

```ts
const SKILLS = ["vocab", "grammar", "reading", "conjugation", "particle", "explain"] as const;
```

- [ ] **Step 2: Run the affected route tests**

Run: `pnpm --filter @nihongo/server test -- dashboard stats library`
Expected: PASS. If a test asserts an exact `by_skill` object shape, update it to include `explain: { ... }` with zeroed counts.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/dashboard.ts server/src/routes/stats.ts server/src/routes/library.ts
git commit -m "feat(server): include explain in dashboard/stats/library skill groups"
```

---

## Task 12: client — `gradeExplanation` api hook + GenerateForm label

**Files:**
- Modify: `client/src/api-hooks.ts`
- Modify: `client/src/components/GenerateForm.tsx:21-27`

- [ ] **Step 1: Add the api hook**

In `client/src/api-hooks.ts`, add `ExplainGradeRequest, ExplainGradeResponse` to the `@nihongo/shared` type import, then append:

```ts
export function gradeExplanation(input: ExplainGradeRequest): Promise<ExplainGradeResponse> {
  return api<ExplainGradeResponse>("/api/explain/grade", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
```

- [ ] **Step 2: Add the GenerateForm label**

In `client/src/components/GenerateForm.tsx`, add to `SKILL_LABELS`:

```ts
const SKILL_LABELS: Record<Skill, string> = {
  vocab: "Vocabulary",
  grammar: "Grammar",
  reading: "Reading",
  conjugation: "Conjugation",
  particle: "Particles",
  explain: "Explain",
};
```

- [ ] **Step 3: Commit**

```bash
git add client/src/api-hooks.ts client/src/components/GenerateForm.tsx
git commit -m "feat(client): explain grade hook + generate label"
```

---

## Task 13: client — `ProductionCard` component

**Files:**
- Create: `client/src/components/ProductionCard.tsx`

A textarea-based card (no swipe — production needs the keyboard and a deliberate submit). Submit → call `gradeExplanation` → render the four dimension scores, corrected version, feedback, and model answer → confirm to advance via `onAnswer(result, answer_given)`. `answer_given` is truncated to 200 chars to fit the existing review column.

- [ ] **Step 1: Implement the component**

Create `client/src/components/ProductionCard.tsx`:

```tsx
import { useState } from "react";
import type { ItemRecord, ExplainPrompt, ExplainAnswer, ExplainGrade, ReviewResult } from "@nihongo/shared";
import { RubyText } from "./RubyText";
import { gradeExplanation } from "../api-hooks";

type Props = {
  item: ItemRecord;
  onAnswer: (result: ReviewResult, answer_given?: string) => void;
};

type Phase =
  | { kind: "writing" }
  | { kind: "grading" }
  | { kind: "graded"; grade: ExplainGrade; result: ReviewResult }
  | { kind: "error"; message: string };

const DIMENSIONS: Array<{ key: keyof ExplainGrade; label: string }> = [
  { key: "connective_use", label: "Connectives" },
  { key: "structure", label: "Structure" },
  { key: "register", label: "Register" },
  { key: "grammar", label: "Grammar" },
];

export function ProductionCard({ item, onAnswer }: Props) {
  const prompt = item.prompt as ExplainPrompt;
  const answer = item.answer as ExplainAnswer;
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "writing" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || phase.kind === "grading") return;
    setPhase({ kind: "grading" });
    try {
      const r = await gradeExplanation({ item_id: item.id, answer_given: text.trim().slice(0, 2000) });
      setPhase({ kind: "graded", grade: r.grade, result: r.result });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "grading failed" });
    }
  }

  function advance(result: ReviewResult) {
    onAnswer(result, text.trim().slice(0, 200));
  }

  return (
    <div className="production-card">
      <span className="flipcard__skill-chip">Explain</span>
      <p className="production-card__task">{prompt.task_english}</p>
      {prompt.task_japanese_ruby && (
        <RubyText html={prompt.task_japanese_ruby} className="production-card__task-ja ruby-hi-contrast" />
      )}
      <div className="production-card__constraints">
        <span className="production-card__register">Register: {prompt.register}</span>
        <ul className="production-card__connectives">
          {prompt.required_connectives.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>

      {phase.kind === "writing" || phase.kind === "grading" ? (
        <form onSubmit={submit} className="production-card__form">
          <textarea
            className="production-card__input"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write 2–4 sentences in Japanese…"
            disabled={phase.kind === "grading"}
          />
          <button type="submit" className="cta cta--primary cta--block" disabled={!text.trim() || phase.kind === "grading"}>
            {phase.kind === "grading" ? "Grading…" : "Submit for grading"}
          </button>
        </form>
      ) : phase.kind === "error" ? (
        <div className="production-card__error">
          <p role="alert" className="is-wrong">{phase.message}</p>
          <button type="button" className="cta cta--primary cta--block" onClick={() => setPhase({ kind: "writing" })}>
            Try again
          </button>
        </div>
      ) : (
        <div className="production-card__reveal">
          <div className="production-card__scores">
            {DIMENSIONS.map((d) => (
              <div key={d.key} className="production-card__score">
                <span className="production-card__score-label">{d.label}</span>
                <span className="production-card__score-val">{Math.round((phase.grade[d.key] as number) * 100)}%</span>
              </div>
            ))}
          </div>
          <p className={`production-card__overall ${phase.result === "got_it" ? "is-correct" : "is-wrong"}`}>
            Overall {Math.round(phase.grade.overall * 100)}% — {phase.result === "got_it" ? "passed" : "keep practicing"}
          </p>
          <p className="production-card__feedback">{phase.grade.feedback}</p>
          <div>
            <p className="production-card__section-label">Corrected</p>
            <RubyText html={phase.grade.corrected_ruby} className="production-card__corrected ruby-hi-contrast" />
          </div>
          <div>
            <p className="production-card__section-label">Model answer</p>
            <RubyText html={answer.model_explanation_ruby} className="production-card__model ruby-hi-contrast" />
          </div>
          <div className="grade-bar">
            <button type="button" className="grade-btn grade-btn--missed" onClick={() => advance("missed")}>
              Missed
            </button>
            <button type="button" className="grade-btn grade-btn--got" onClick={() => advance("got_it")}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add minimal styles**

Append to `client/src/styles/screens.css` (match the file's existing token usage; these classes mirror the `typed-card`/`flipcard` patterns):

```css
.production-card { display: flex; flex-direction: column; gap: 12px; padding: 20px; }
.production-card__task { font-family: var(--font-display); font-size: 18px; font-weight: 500; }
.production-card__constraints { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.production-card__connectives { display: flex; gap: 6px; list-style: none; padding: 0; margin: 0; flex-wrap: wrap; }
.production-card__connectives li { border: 1px solid var(--hairline, #ccc); border-radius: 999px; padding: 2px 10px; font-size: 13px; }
.production-card__input { width: 100%; font-size: 17px; padding: 10px; border-radius: 8px; }
.production-card__scores { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.production-card__score { display: flex; flex-direction: column; align-items: center; }
.production-card__score-val { font-family: var(--font-display); font-size: 18px; }
.production-card__overall.is-correct { color: var(--got, #1a7f37); }
.production-card__overall.is-wrong { color: var(--missed, #b3261e); }
.production-card__section-label { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; }
```

If `screens.css` uses different variable names, reuse whatever `.typed-card` already references (check the surrounding rules first).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ProductionCard.tsx client/src/styles/screens.css
git commit -m "feat(client): ProductionCard for explain skill"
```

---

## Task 14: client — route `explain` to `ProductionCard` in practice

**Files:**
- Modify: `client/src/screens/PracticeScreen.tsx`

- [ ] **Step 1: Import and branch**

In `client/src/screens/PracticeScreen.tsx`, add the import near the other card imports:

```ts
import { ProductionCard } from "../components/ProductionCard";
```

Change the card-selection block (lines ~133-139) to add the `explain` branch first:

```tsx
        {current.skill === "explain" ? (
          <ProductionCard key={current.id} item={current} onAnswer={handleAnswerWithText} />
        ) : current.skill === "particle" ? (
          <MultipleChoiceCard key={current.id} item={current} onAnswer={handleAnswer} />
        ) : current.skill === "conjugation" ? (
          <TypedInputCard key={current.id} item={current} onAnswer={handleAnswerWithText} />
        ) : (
          <FlipCard key={current.id} item={current} onAnswer={handleAnswer} />
        )}
```

`handleAnswerWithText` already submits the review (with `answer_given`) and advances, so grading is fully decoupled from the review write.

- [ ] **Step 2: Typecheck + build the client**

Run: `pnpm --filter @nihongo/client build`
Expected: PASS — all `Record<Skill, …>` are now exhaustive (`SKILL_META`, `SKILL_LABELS`), no missing-case errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/screens/PracticeScreen.tsx
git commit -m "feat(client): render ProductionCard for explain in practice flow"
```

---

## Task 15: Full workspace build + typecheck gate

**Files:** none (verification task)

- [ ] **Step 1: Build everything**

Run: `pnpm -r build`
Expected: PASS in `shared`, `gen`, `server`, `client`. No remaining non-exhaustive `Record<Skill, …>` errors.

- [ ] **Step 2: Run all unit tests**

Run: `pnpm -r test` (or per-package: `pnpm --filter @nihongo/gen test && pnpm --filter @nihongo/server test`)
Expected: PASS — including the new `parseExplainBatch`, `parseExplainGrade`, `runGeneration explain`, `gradeExplanation`, and `/api/explain/grade` tests.

- [ ] **Step 3: Commit (only if any fixups were needed)**

```bash
git add -A
git commit -m "chore: fixups for full explain build/test gate"
```

---

## Task 16: e2e — generate → practice → grade → schedule

**Files:**
- Create: `e2e/tests/explain.spec.ts`

Mirrors `e2e/tests/conjugation.spec.ts`. With `NIHONGO_FAKE_AI=1`, generation inserts the 2 `EXPLAIN_FAKE` items and grading returns the passing fixture.

- [ ] **Step 1: Write the test**

Create `e2e/tests/explain.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login, generateViaSettings, practiceSkill } from "./helpers";

test.beforeEach(() => {
  loadFixture("seed-test-empty");
});

test("explain: generate → write → AI grade → confirm + advance", async ({ page }) => {
  await login(page);
  await generateViaSettings(page, "explain");
  // EXPLAIN_FAKE has 2 items.
  await expect(page.locator(".skill-card--explain .today__skill-num")).toContainText("2", { timeout: 10_000 });

  await practiceSkill(page, "explain");

  const input = page.locator(".production-card__input");
  await expect(input).toBeVisible();
  await input.fill("結論として、移行しました。その結果、性能が向上しました。一方で、コストは増えました。");
  await page.getByRole("button", { name: /Submit for grading/i }).click();

  // Graded view: scores + corrected + grade bar.
  await expect(page.locator(".production-card__overall")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".production-card__corrected")).toBeVisible();

  await page.getByRole("button", { name: /Got it/i }).click();
  // Next card prompt, in-session counter, or summary — all valid post-grade states.
  await expect(page.locator(".practice-bar__count, .summary__title, .production-card__task").first()).toBeVisible();
});
```

Confirm the Today skill row exposes `.skill-card--explain .today__skill-num` (the redesigned Today renders a row per skill from `SKILL_ORDER`, which now includes `explain`). If the selector differs, inspect the rendered DOM and adjust — the `.skill-card--<skill>` hook is documented as stable in `e2e/tests/helpers.ts`.

- [ ] **Step 2: Run the e2e test**

Run: `pnpm --filter @nihongo/e2e test -- explain` (or the repo's documented Playwright command — check `e2e/package.json`). Ensure the server runs with `NIHONGO_FAKE_AI=1` (the existing generate/conjugation e2e already depend on this — reuse the same global setup).
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/explain.spec.ts
git commit -m "test(e2e): explain generate→write→grade→advance"
```

---

## Self-Review

**Spec coverage** (issue §"MVP scope"):

1. *Skill enum + Explain types + fix exhaustive Records* → Task 2 (types) + Task 3 (`SKILL_META`) + Task 11 (server `SKILLS`) + Task 12 (`SKILL_LABELS`). ✓
2. *`generateExplainBatch` + enricher* → Task 4–7 (gen) + Task 8 (server enricher). ✓
3. *`gradeExplanation` service + wired into review path with threshold mapping* → Task 9 (service, 0.6 threshold) + Task 10 (route). Review write stays on the untouched `POST /api/reviews` path via `handleAnswerWithText` (Task 14). ✓
4. *`ProductionCard` wired into practice flow* → Task 13 + Task 14. ✓
5. *Store attempt truncated into `answer_given`, no new table* → Task 13 (`.slice(0, 200)`), Task 1 only widens the skill CHECK. ✓

**Acceptance criteria:**
- `pnpm -r build` / no non-exhaustive `Record<Skill,…>` → Task 15. ✓
- gen unit test parses an explain batch → Task 4 (+ grade parse Task 5). ✓
- server unit test: grade maps to got_it/missed at 0.6 + feeds nextState → Task 9 covers the mapping; `nextState` is unchanged and already exercised by `leitner.test.ts` / `reviews.test.ts`, and is driven through the standard review path. ✓
- e2e: generate → queue → ProductionCard → graded → scheduled → Task 16. ✓
- Grading failures degrade gracefully → Task 10 (502 + message) + Task 13 ("Try again", no lost session — the review is only written on confirm). ✓

**Out of scope (correctly omitted):** dedicated `explain_attempts` table, per-dimension analytics, streaming, offline. The 200-char `answer_given` cap is retained (truncate in `ProductionCard`).

**Type consistency check:** `ExplainGrade` shape (Task 2) is produced identically by `gradeExplanation` (Task 9, `corrected_ruby` added server-side) and consumed by `ProductionCard` (Task 13, `DIMENSIONS` keys `connective_use`/`structure`/`register`/`grammar` all exist on `ExplainGrade`). `ExplainGradeRaw` (gen, `corrected_japanese`) vs `ExplainGrade` (shared, `corrected_ruby`) — the `toRubyHtml` conversion bridging them is the single transform, in Task 9. `gradeToResult`/`PASS_THRESHOLD` = 0.6 consistent between service and tests.

**Open verification points (resolved during planning):**
- Task 1: constraint name expected to be `items_skill_check` (Postgres auto-name). A successful migration confirms it; if `DROP CONSTRAINT` errors, find the real name via `\d items`.
- Task 10: `NIHONGO_FAKE_AI=1` set in `beforeEach` (matching `generate.test.ts`); vitest config untouched. ✓ resolved.
- Task 10/14: passcode is global (`app.use("/api", passcodeMiddleware(...))`); mount `app.use("/api/explain", explainRouter)` after items router. ✓ resolved.
- Task 16: confirm the `.skill-card--explain .today__skill-num` Today selector against the rendered DOM during execution; the `.skill-card--<skill>` hook is documented stable.
