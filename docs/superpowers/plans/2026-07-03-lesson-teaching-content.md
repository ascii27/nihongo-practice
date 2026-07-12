# Lesson Teaching Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate distinct per-section teaching content (explanation + worked examples) for lessons, separate from and aware of the check cards, and render it in the walkthrough's teach phase.

**Architecture:** A new per-section LLM call (in the `gen` package) produces `{ explanation, examples[] }` for concept skills, steered to avoid the section's check-card sentences. `generateLessonInto` stores the enriched result in a new `lesson_sections` table. `getLessonDetail` attaches it to each section; the client renders it in the teach phase, falling back to the current scrape for old lessons and showing a static intro for task skills.

**Tech Stack:** TypeScript monorepo — `gen` (Anthropic SDK generators), `shared` (Zod types), `server` (Express + `pg`, node-pg-migrate SQL migrations, Vitest + supertest), `client` (React + Vite), `e2e` (Playwright).

## Global Constraints

- Anthropic calls go through `callWithRetry` in `gen/src/generate.ts` using `MODEL`; never call the SDK directly elsewhere.
- Every batch generator MUST honour `process.env.NIHONGO_FAKE_AI === "1"` with a deterministic fake path (server + e2e tests run with fake AI).
- Japanese stays raw in the `gen` package; ruby (`toRubyHtml`) enrichment happens in the server service, mirroring `enrichFor` in `server/src/services/generate.ts`.
- Shared types are Zod schemas in `shared/src/types.ts` with an inferred type of the same name.
- Concept skills = `vocab`, `grammar`, `particle`, `conjugation`. Task skills = `reading`, `listening`, `explain`. Only concept skills get generated teaching content.
- `generateLessonInto` MUST NOT throw — failures are recorded on the `lessons` row (existing behaviour).
- Migrations are plain SQL in `db/migrations/<epoch-ms>_<name>.sql`, applied via `npm --workspace server run db:migrate`.
- SQL migration timestamps must sort after the latest existing one (`1783123200000_lessons.sql`).

---

### Task 1: Teaching generator in the `gen` package

**Files:**
- Modify: `gen/src/prompt.ts` (add `TEACHING_SYSTEM` + `buildTeachingPrompt`)
- Modify: `gen/src/parse.ts` (add `RawTeaching` type + `parseTeaching`)
- Modify: `gen/src/generate.ts` (add `TEACHING_FAKE` + `generateTeachingBatch`)
- Modify: `gen/src/index.ts` (export the new symbols)
- Test: `gen/src/parse.test.ts` (parser tests), `gen/src/generate.test.ts` (fake-path test)

**Interfaces:**
- Produces:
  - `type RawTeaching = { explanation: string; examples: { jp: string; en: string; note?: string }[] }`
  - `parseTeaching(raw: string): RawTeaching`
  - `buildTeachingPrompt(args: { skill: Skill; topic: string; jlpt_level: string; avoid: string[] }): PromptPair`
  - `generateTeachingBatch(args: { skill: Skill; topic: string; jlpt_level: string; avoid: string[]; client?: ClientLike; signal?: AbortSignal }): Promise<{ teaching: RawTeaching; usage: Usage; raw: string }>`
- Consumes: `Skill` from `@nihongo/shared`, existing `PromptPair`, `stripFences`, `callWithRetry`, `MODEL`, `Usage`.

- [ ] **Step 1: Write the failing parser tests**

Add to `gen/src/parse.test.ts` (import `parseTeaching` in the existing import from `./parse.js`):

```ts
import { parseTeaching } from "./parse.js";

describe("parseTeaching", () => {
  const good = JSON.stringify({
    explanation: "は marks the topic of the sentence.",
    examples: [
      { jp: "私は学生です。", en: "I am a student.", note: "は marks 私 as the topic" },
      { jp: "今日は寒いです。", en: "It is cold today." },
    ],
  });

  it("accepts well-formed teaching content", () => {
    const t = parseTeaching(good);
    expect(t.explanation).toContain("topic");
    expect(t.examples).toHaveLength(2);
    expect(t.examples[0]!.jp).toBe("私は学生です。");
    expect(t.examples[0]!.note).toBe("は marks 私 as the topic");
    expect(t.examples[1]!.note).toBeUndefined();
  });

  it("strips code fences before parsing", () => {
    expect(parseTeaching("```json\n" + good + "\n```").examples).toHaveLength(2);
  });

  it("rejects a missing explanation", () => {
    expect(() => parseTeaching(JSON.stringify({ examples: [] }))).toThrow();
  });

  it("rejects examples that are not an array", () => {
    expect(() => parseTeaching(JSON.stringify({ explanation: "x", examples: {} }))).toThrow();
  });

  it("rejects an example missing jp/en", () => {
    expect(() => parseTeaching(JSON.stringify({ explanation: "x", examples: [{ jp: "あ" }] }))).toThrow();
  });
});
```

- [ ] **Step 2: Run the parser tests to verify they fail**

Run: `npm --workspace gen run test -- parse`
Expected: FAIL — `parseTeaching is not a function` / not exported.

- [ ] **Step 3: Implement `parseTeaching` + `RawTeaching`**

Add to `gen/src/parse.ts` (it already has `stripFences`):

```ts
export type RawTeaching = {
  explanation: string;
  examples: { jp: string; en: string; note?: string }[];
};

export function parseTeaching(raw: string): RawTeaching {
  const parsed = JSON.parse(stripFences(raw));
  if (typeof parsed?.explanation !== "string" || parsed.explanation.trim() === "") {
    throw new Error("teaching missing 'explanation'");
  }
  if (!Array.isArray(parsed?.examples)) {
    throw new Error("teaching 'examples' must be an array");
  }
  for (const ex of parsed.examples) {
    if (typeof ex?.jp !== "string" || typeof ex?.en !== "string") {
      throw new Error("teaching example missing 'jp'/'en'");
    }
    if (ex.note !== undefined && typeof ex.note !== "string") {
      throw new Error("teaching example has invalid 'note'");
    }
  }
  return parsed as RawTeaching;
}
```

- [ ] **Step 4: Run the parser tests to verify they pass**

Run: `npm --workspace gen run test -- parse`
Expected: PASS.

- [ ] **Step 5: Add the teaching prompt**

Add to `gen/src/prompt.ts` (it already exports `type PromptPair` and imports `Skill` — if not, add `import type { Skill } from "@nihongo/shared";`):

```ts
const TEACHING_SYSTEM = `You write a short teaching block that prepares a Japanese learner for a set of practice cards on one skill. Explain the concept clearly in ENGLISH, then give worked example sentences.

Reply ONLY with valid JSON matching this exact schema:
{"explanation": string, "examples": [{"jp": string, "en": string, "note": string}]}

Rules:
- "explanation" is 2–4 sentences of plain English teaching the concept at the given JLPT level.
- Provide 2–3 examples. "jp" is a natural Japanese sentence (no furigana markup), "en" is its English translation, "note" is a short English note on why it works.
- Do NOT reuse any of the sentences or exact items listed under "Already tested" — teach with DIFFERENT examples that still prepare the learner for those.`;

const PARTICLE_TEACHING_EXTRA = ` This is a particle lesson: explicitly explain in English what each particle does, and contrast the commonly confused ones (e.g. は vs が, に vs で).`;

export function buildTeachingPrompt(args: {
  skill: Skill;
  topic: string;
  jlpt_level: string;
  avoid: string[];
}): PromptPair {
  const system = args.skill === "particle" ? TEACHING_SYSTEM + PARTICLE_TEACHING_EXTRA : TEACHING_SYSTEM;
  const lines = [
    `Skill: ${args.skill}.`,
    `Topic: ${args.topic}.`,
    `Target JLPT level: ${args.jlpt_level}.`,
  ];
  if (args.avoid.length) {
    lines.push("Already tested (do not reuse):");
    for (const a of args.avoid) lines.push(`- ${a}`);
  }
  return { system, user: lines.join("\n") };
}
```

- [ ] **Step 6: Write the failing generator fake-path test**

Add to `gen/src/generate.test.ts` (import `generateTeachingBatch` from `./generate.js`):

```ts
import { generateTeachingBatch } from "./generate.js";

describe("generateTeachingBatch (fake AI)", () => {
  it("returns deterministic teaching content without a client", async () => {
    process.env.NIHONGO_FAKE_AI = "1";
    const r = await generateTeachingBatch({ skill: "particle", topic: "at the station", jlpt_level: "N4", avoid: ["は — topic"] });
    expect(r.teaching.explanation.length).toBeGreaterThan(0);
    expect(r.teaching.examples.length).toBeGreaterThan(0);
    expect(r.teaching.examples[0]!.jp).toBeTruthy();
    expect(r.teaching.examples[0]!.en).toBeTruthy();
  });
});
```

- [ ] **Step 7: Run the generator test to verify it fails**

Run: `npm --workspace gen run test -- generate`
Expected: FAIL — `generateTeachingBatch is not a function`.

- [ ] **Step 8: Implement `generateTeachingBatch` + fake fixture**

Add to `gen/src/generate.ts` (import additions: add `parseTeaching`, `type RawTeaching` to the `./parse.js` import, and `buildTeachingPrompt` to the `./prompt.js` import; add `import type { Skill } from "@nihongo/shared";` if not present):

```ts
const TEACHING_FAKE: RawTeaching = {
  explanation: "This is a fake teaching explanation used in tests.",
  examples: [
    { jp: "これは例文です。", en: "This is an example sentence.", note: "fake note" },
    { jp: "もう一つの例です。", en: "Here is another example." },
  ],
};

export async function generateTeachingBatch(args: {
  skill: Skill;
  topic: string;
  jlpt_level: string;
  avoid: string[];
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ teaching: RawTeaching; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    return { teaching: TEACHING_FAKE, usage: { input_tokens: 0, output_tokens: 0 }, raw: JSON.stringify(TEACHING_FAKE) };
  }
  const { system, user } = buildTeachingPrompt(args);
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<RawTeaching>({
    system, user, parse: parseTeaching, client, signal: args.signal,
  });
  return { teaching: value, usage, raw };
}
```

- [ ] **Step 9: Export the new symbols**

In `gen/src/index.ts`: add `parseTeaching`, `type RawTeaching` to the `./parse.js` export; add `buildTeachingPrompt` to the `./prompt.js` export; add `generateTeachingBatch` to the `./generate.js` export.

- [ ] **Step 10: Run the whole gen test suite + typecheck**

Run: `npm --workspace gen run test` then `npm --workspace gen run build`
Expected: PASS, no type errors.

- [ ] **Step 11: Commit**

```bash
git add gen/src/prompt.ts gen/src/parse.ts gen/src/generate.ts gen/src/index.ts gen/src/parse.test.ts gen/src/generate.test.ts
git commit -m "feat(gen): teaching-content generator (explanation + examples)"
```

---

### Task 2: Shared teaching types

**Files:**
- Modify: `shared/src/types.ts` (add `TeachingExample`, `LessonTeaching`; add `teaching` to `LessonSectionDetail`)
- Test: `shared/src/types.test.ts`

**Interfaces:**
- Consumes: existing `ItemRecord`, `Skill`, `z`.
- Produces:
  - `LessonTeaching = { explanation: string; examples: { jp_ruby: string; en: string; note?: string }[] }` (Zod schema + type)
  - `LessonSectionDetail` gains `teaching: LessonTeaching | null`.

- [ ] **Step 1: Write the failing type test**

Add to `shared/src/types.test.ts`:

```ts
import { LessonTeaching, LessonSectionDetail } from "./types.js";

describe("LessonTeaching", () => {
  it("parses explanation + examples with optional note", () => {
    const t = LessonTeaching.parse({
      explanation: "は marks the topic.",
      examples: [{ jp_ruby: "<ruby>私<rt>わたし</rt></ruby>は", en: "As for me" }],
    });
    expect(t.examples[0]!.en).toBe("As for me");
  });

  it("allows a section with null teaching", () => {
    const s = LessonSectionDetail.parse({ section: "reading", items: [], teaching: null });
    expect(s.teaching).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace shared run test -- types`
Expected: FAIL — `LessonTeaching` is not exported / `teaching` rejected as unknown key.

- [ ] **Step 3: Add the schemas**

In `shared/src/types.ts`, before `LessonSectionDetail`:

```ts
export const TeachingExample = z.object({
  jp_ruby: z.string(),
  en: z.string(),
  note: z.string().optional(),
});
export type TeachingExample = z.infer<typeof TeachingExample>;

export const LessonTeaching = z.object({
  explanation: z.string(),
  examples: z.array(TeachingExample),
});
export type LessonTeaching = z.infer<typeof LessonTeaching>;
```

Then change `LessonSectionDetail`:

```ts
export const LessonSectionDetail = z.object({
  section: Skill,
  items: z.array(ItemRecord),
  teaching: LessonTeaching.nullable(),
});
export type LessonSectionDetail = z.infer<typeof LessonSectionDetail>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace shared run test -- types`
Expected: PASS.

- [ ] **Step 5: Build shared**

Run: `npm --workspace shared run build`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add shared/src/types.ts shared/src/types.test.ts
git commit -m "feat(shared): LessonTeaching type + teaching on LessonSectionDetail"
```

---

### Task 3: Migration + generate teaching into `lesson_sections`

**Files:**
- Create: `db/migrations/1783209600000_lesson_sections.sql`
- Modify: `server/src/services/lesson-generate.ts` (add `CONCEPT_SKILLS`, `avoidHintsFor`, teaching generation + insert)
- Test: `server/src/routes/lessons.test.ts` (assert `lesson_sections` populated for concept skills only)

**Interfaces:**
- Consumes: `generateTeachingBatch`, `toRubyHtml`, `computeCost` from `@nihongo/gen`; existing `runGeneration`, `pool`.
- Produces: rows in `lesson_sections (lesson_id, section, content jsonb)` where `content` matches `LessonTeaching`. `avoidHintsFor(skill: Skill, items: ItemRecord[]): string[]`.

- [ ] **Step 1: Create the migration**

Create `db/migrations/1783209600000_lesson_sections.sql`:

```sql
-- 1783209600000_lesson_sections.sql
-- Per-section teaching content for a lesson: an English explanation plus worked
-- examples, generated separately from (and aware of) the section's check cards.
-- One row per taught (concept) section. Task sections have no row.

CREATE TABLE lesson_sections (
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  section   text NOT NULL,
  content   jsonb NOT NULL,
  PRIMARY KEY (lesson_id, section)
);
```

- [ ] **Step 2: Apply the migration**

Run: `npm --workspace server run db:migrate`
Expected: log shows `1783209600000_lesson_sections` applied; no error.

- [ ] **Step 3: Write the failing generation test**

Add a test to `server/src/routes/lessons.test.ts` (it already imports `resetDb`, `request`, `makeTestApp`, `lessonsRouter`, sets `NIHONGO_FAKE_AI=1` in `beforeEach`). Add `import { pool } from "../db/pool.js";` at the top if not present:

```ts
it("stores teaching content for concept sections only", async () => {
  const create = await request(app).post("/api/lessons").set("X-Passcode", PASSCODE)
    .send({ topic: "at the station", jlpt_level: "N4", skills: ["vocab", "particle", "reading"] });
  const id = create.body.id as string;

  let status = "generating";
  for (let i = 0; i < 100 && status === "generating"; i++) {
    const s = await request(app).get(`/api/lessons/${id}/status`).set("X-Passcode", PASSCODE);
    status = s.body.status;
    if (status === "generating") await new Promise((r) => setTimeout(r, 50));
  }
  expect(status).toBe("ready");

  const rows = await pool.query<{ section: string; content: { explanation: string; examples: unknown[] } }>(
    `SELECT section, content FROM lesson_sections WHERE lesson_id = $1 ORDER BY section`, [id],
  );
  const sections = rows.rows.map((r) => r.section).sort();
  expect(sections).toEqual(["particle", "vocab"]); // reading (task skill) gets none
  const particle = rows.rows.find((r) => r.section === "particle")!;
  expect(particle.content.explanation.length).toBeGreaterThan(0);
  expect(Array.isArray(particle.content.examples)).toBe(true);
  expect((particle.content.examples[0] as { jp_ruby: string }).jp_ruby).toContain("<");
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm --workspace server run test -- lessons`
Expected: FAIL — `lesson_sections` has 0 rows (nothing writes it yet).

- [ ] **Step 5: Implement generation into `lesson_sections`**

In `server/src/services/lesson-generate.ts`:

Add imports at the top:

```ts
import { generateTeachingBatch, toRubyHtml, computeCost } from "@nihongo/gen";
import type { ItemRecord } from "@nihongo/shared";
```

Add the concept set + avoid helper (below the imports):

```ts
const CONCEPT_SKILLS = new Set<Skill>(["vocab", "grammar", "particle", "conjugation"]);

// Short human-readable hints describing what each check card tests, so the
// teaching generator can prepare the learner for them while using DIFFERENT
// example sentences. Reads the same prompt/answer fields the teach view uses.
export function avoidHintsFor(skill: Skill, items: ItemRecord[]): string[] {
  return items.map((it) => {
    const p = it.prompt as Record<string, unknown>;
    const a = it.answer as Record<string, unknown>;
    switch (skill) {
      case "vocab": return `${p.target ?? ""} — ${p.sentence_english ?? ""}`.trim();
      case "grammar": return `${p.pattern ?? ""} — ${p.sentence_english ?? ""}`.trim();
      case "particle": return String(a.explanation ?? "");
      case "conjugation": return `${p.base ?? ""} (${p.tense ?? ""})`.trim();
      default: return "";
    }
  }).filter((s) => s !== "");
}
```

Inside `generateLessonInto`, within the `for (const skill of skills)` loop, after the existing `lesson_items` insert block (still inside the `try`), add:

```ts
      if (CONCEPT_SKILLS.has(skill)) {
        const t = await generateTeachingBatch({
          skill, topic, jlpt_level, avoid: avoidHintsFor(skill, r.items),
        });
        totalCost += computeCost(t.usage);
        const examples = await Promise.all(
          t.teaching.examples.map(async (e) => ({
            jp_ruby: await toRubyHtml(e.jp),
            en: e.en,
            ...(e.note ? { note: e.note } : {}),
          })),
        );
        await pool.query(
          `INSERT INTO lesson_sections (lesson_id, section, content)
           VALUES ($1, $2, $3)
           ON CONFLICT (lesson_id, section) DO UPDATE SET content = EXCLUDED.content`,
          [lessonId, skill, JSON.stringify({ explanation: t.teaching.explanation, examples })],
        );
      }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm --workspace server run test -- lessons`
Expected: PASS (both the new test and the existing "walk a lesson" test).

- [ ] **Step 7: Commit**

```bash
git add db/migrations/1783209600000_lesson_sections.sql server/src/services/lesson-generate.ts server/src/routes/lessons.test.ts
git commit -m "feat(lessons): generate teaching content into lesson_sections"
```

---

### Task 4: Return teaching in the lesson detail

**Files:**
- Modify: `server/src/services/lessons.ts` (`getLessonDetail` fetches + attaches `teaching`)
- Test: `server/src/routes/lessons.test.ts` (assert detail exposes `teaching`)

**Interfaces:**
- Consumes: `lesson_sections` rows (Task 3), `LessonTeaching` type (Task 2).
- Produces: each `LessonSectionDetail` in the detail response has `teaching: LessonTeaching | null`.

- [ ] **Step 1: Write the failing detail test**

Add to `server/src/routes/lessons.test.ts`:

```ts
it("exposes teaching content on concept sections and null on task sections", async () => {
  const create = await request(app).post("/api/lessons").set("X-Passcode", PASSCODE)
    .send({ topic: "ordering food", jlpt_level: "N4", skills: ["vocab", "reading"] });
  const id = create.body.id as string;

  let status = "generating";
  for (let i = 0; i < 100 && status === "generating"; i++) {
    const s = await request(app).get(`/api/lessons/${id}/status`).set("X-Passcode", PASSCODE);
    status = s.body.status;
    if (status === "generating") await new Promise((r) => setTimeout(r, 50));
  }
  expect(status).toBe("ready");

  const detail = await request(app).get(`/api/lessons/${id}`).set("X-Passcode", PASSCODE);
  const vocab = detail.body.sections.find((s: { section: string }) => s.section === "vocab");
  const reading = detail.body.sections.find((s: { section: string }) => s.section === "reading");
  expect(vocab.teaching).not.toBeNull();
  expect(vocab.teaching.explanation.length).toBeGreaterThan(0);
  expect(vocab.teaching.examples[0].jp_ruby).toBeTruthy();
  expect(reading.teaching).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace server run test -- lessons`
Expected: FAIL — `vocab.teaching` is `undefined` (not returned yet).

- [ ] **Step 3: Attach teaching in `getLessonDetail`**

In `server/src/services/lessons.ts`, add `LessonTeaching` to the type import from `@nihongo/shared`.

In `getLessonDetail`, after the `ir` items query and before building `bySection`/`sections`, add a query for teaching rows:

```ts
  const tr = await pool.query<{ section: string; content: LessonTeaching }>(
    `SELECT section, content FROM lesson_sections WHERE lesson_id = $1`, [id],
  );
  const teachingBySection = new Map<string, LessonTeaching>(
    tr.rows.map((row) => [row.section, row.content]),
  );
```

Then change the `sections` mapping to include `teaching`:

```ts
  const sections: LessonSectionDetail[] = (lesson.skills as Skill[])
    .filter((s) => bySection.has(s))
    .map((s) => ({ section: s, items: bySection.get(s)!, teaching: teachingBySection.get(s) ?? null }));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace server run test -- lessons`
Expected: PASS.

- [ ] **Step 5: Typecheck the server**

Run: `npm --workspace server run build`
Expected: no type errors (confirms `LessonSectionDetail` now requires `teaching`).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/lessons.ts server/src/routes/lessons.test.ts
git commit -m "feat(lessons): return teaching content in lesson detail"
```

---

### Task 5: Render teaching content in the walkthrough

**Files:**
- Modify: `client/src/lib/skills.ts` (add `TASK_INTRO`)
- Modify: `client/src/components/LessonSection.tsx` (teach phase renders teaching / intro / fallback; accept `teaching` prop)
- Modify: `client/src/screens/LessonWalkthroughScreen.tsx` (pass `teaching` to `LessonSection`)
- Modify: `client/src/styles/screens.css` (styles for explanation/examples/note)
- Test: `e2e/tests/lessons.spec.ts` (assert teaching explanation is visible in the teach phase)

**Interfaces:**
- Consumes: `LessonSectionDetail.teaching` (Task 2/4), existing `RubyText`, `SKILL_META`.
- Produces: teach phase UI.

- [ ] **Step 1: Add the task-intro map**

In `client/src/lib/skills.ts`, add:

```ts
// Static one-line intros for task skills, which have no generated teaching block.
export const TASK_INTRO: Partial<Record<Skill, string>> = {
  reading: "Read the short passage, then answer the comprehension question.",
  listening: "Listen to the audio, then answer the questions.",
  explain: "Write a short explanation in Japanese using the required connectives.",
};
```

- [ ] **Step 2: Update `LessonSection` to accept and render teaching**

In `client/src/components/LessonSection.tsx`:

Change the import from `../lib/skills` to also pull `TASK_INTRO`:

```ts
import { SKILL_META, TASK_INTRO } from "../lib/skills";
```

Add `LessonTeaching` to the `@nihongo/shared` type import, and change `Props`:

```ts
type Props = { section: Skill; items: ItemRecord[]; teaching: LessonTeaching | null; onDone: () => void };
```

Update the component signature:

```ts
export function LessonSection({ section, items, teaching, onDone }: Props) {
```

Replace the entire `if (phase === "teach") { ... }` block with:

```tsx
  if (phase === "teach") {
    return (
      <div className="teach">
        <h2 className="teach__heading">{SKILL_META[section].label}</h2>
        {teaching ? (
          <div className="teach__body">
            <p className="teach__explanation">{teaching.explanation}</p>
            <div className="teach__examples">
              {teaching.examples.map((ex, idx) => (
                <div className="teach__example" key={idx}>
                  <RubyText html={ex.jp_ruby} className="teach__ruby" />
                  <span className="teach__gloss">{ex.en}</span>
                  {ex.note ? <span className="teach__note">{ex.note}</span> : null}
                </div>
              ))}
            </div>
          </div>
        ) : TASK_INTRO[section] ? (
          <p className="teach__explanation">{TASK_INTRO[section]}</p>
        ) : (
          <div className="teach__lines">
            {items.map((it) => <TeachLine key={it.id} item={it} />)}
          </div>
        )}
        <button type="button" className="cta cta--primary cta--block" onClick={() => setPhase("check")}>Start check →</button>
      </div>
    );
  }
```

(`TeachLine` stays in the file as the fallback for old lessons.)

- [ ] **Step 3: Pass `teaching` from the walkthrough screen**

In `client/src/screens/LessonWalkthroughScreen.tsx`, update the `LessonSection` usage:

```tsx
        <LessonSection key={section.section} section={section.section} items={section.items} teaching={section.teaching} onDone={nextSection} />
```

- [ ] **Step 4: Add styles**

In `client/src/styles/screens.css`, after the `.teach__gloss` rule (line ~707), add:

```css
.teach__body { display: flex; flex-direction: column; gap: 16px; flex: 1; }
.teach__explanation { font-size: 15px; line-height: 1.6; color: var(--fg); margin: 0; }
.teach__examples { display: flex; flex-direction: column; gap: 12px; }
.teach__example { display: flex; flex-direction: column; gap: 2px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.teach__note { font-size: 12px; color: var(--fg-secondary); font-style: italic; }
```

- [ ] **Step 5: Typecheck + build the client**

Run: `npm --workspace client run build`
Expected: PASS (confirms the new required `teaching` prop is wired through).

- [ ] **Step 6: Add an e2e assertion for the teach content**

In `e2e/tests/lessons.spec.ts`, inside the walk loop, the first section is Vocab (a concept skill). After `await openBtn.click();` and before the walk loop, add:

```ts
  // The first (Vocab) section shows generated teaching content, not just cards.
  await expect(page.locator(".teach__explanation").first()).toBeVisible({ timeout: 15_000 });
```

- [ ] **Step 7: Run the e2e**

Run: `npm --workspace e2e test -- lessons`
Expected: PASS — lesson creates, teach content shows, walk completes.

- [ ] **Step 8: Commit**

```bash
git add client/src/lib/skills.ts client/src/components/LessonSection.tsx client/src/screens/LessonWalkthroughScreen.tsx client/src/styles/screens.css e2e/tests/lessons.spec.ts
git commit -m "feat(client): render lesson teaching content in the teach phase"
```

---

## Self-Review

**Spec coverage:**
- Richer explanations + examples → Tasks 1, 3, 5. ✓
- Particle sections include English explanations → `PARTICLE_TEACHING_EXTRA` (Task 1) + English `explanation`/`note` in schema (Task 2), rendered Task 5. ✓
- Teaching distinct from check cards, cards reused → separate generator + `avoidHintsFor` (Tasks 1, 3); card generation untouched. ✓
- Structured JSON → Zod `LessonTeaching` (Task 2). ✓
- One call per section, concept skills only → `CONCEPT_SKILLS` loop (Task 3). ✓
- Teach↔check aware/avoid-overlap → `avoid` list wired through (Tasks 1, 3). ✓
- `lesson_sections` table → Task 3 migration. ✓
- Old lessons fall back → `TeachLine` fallback (Task 5); task skills → `TASK_INTRO` (Task 5). ✓
- Testing (parse accept/reject, generation writes rows, detail returns teaching, e2e) → Tasks 1–5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `RawTeaching` (`jp`/`en`/`note`, gen side) vs `LessonTeaching`/`TeachingExample` (`jp_ruby`/`en`/`note`, stored/client side) — the server enrichment in Task 3 Step 5 maps `jp → jp_ruby` via `toRubyHtml`, so the boundary is explicit and consistent. `generateTeachingBatch` returns `{ teaching, usage, raw }` and is consumed as `t.teaching.*` in Task 3. `avoidHintsFor(skill, items)` signature matches its call site. ✓
