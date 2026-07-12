# Lesson Teaching Content — Design

**Date:** 2026-07-03
**Branch:** `feat/lessons-core`
**Status:** Approved, ready for implementation plan

## Problem

A generated lesson today has no real teaching material. The walkthrough's
**teach** phase (`client/src/components/LessonSection.tsx` → `TeachLine`) simply
scrapes the section's *check cards* and renders them face-up (a ruby line + a
gloss pulled out of each card's `prompt`/`answer`). The **check** phase then
shows those same cards interactively. So "lesson content" is currently identical
to the cards used to check understanding.

We want three things:

1. Lesson content should include richer **explanations and examples**.
2. The **particle** section should include **English explanations**.
3. Lesson (teaching) content should be **distinct** from the check cards. The
   check cards continue to be `items` that flow into the review queue and are
   reused in practice.

## Solution overview

Generate a separate block of **teaching content** per concept section — an
explanation plus worked example sentences — with its own LLM call that is aware
of the section's check cards so it can *avoid duplicating* them while still
preparing the learner for them. Store it on the lesson, surface it through the
detail endpoint, and render it in the teach phase. Card generation, the check
flow, the review queue, and practice are all unchanged.

## Decisions (from brainstorming)

- **Content shape:** structured JSON (not freeform markdown) — consistent
  rendering and enforceable English coverage.
- **Generation strategy:** one LLM call **per section**, mirroring the existing
  per-skill card pipeline.
- **Teach ↔ check relationship:** teaching generation is **aware** of the check
  cards — it is told to use *different* example sentences but to prepare the
  learner for the concepts those cards test.
- **Scope:** teaching content is generated only for **concept skills**
  (`vocab`, `grammar`, `particle`, `conjugation`). Task skills (`reading`,
  `listening`, `explain`) get a static client-side task intro, no LLM call.
- **Storage:** a dedicated `lesson_sections` table (not a JSON column on
  `lessons`).
- **Back-compat:** lessons already generated in prod have no teaching rows and
  **fall back** to the current `TeachLine` scrape. No backfill.

## 1. Data model

New migration adds:

```sql
create table lesson_sections (
  lesson_id uuid not null references lessons(id) on delete cascade,
  section   text not null,          -- skill: vocab | grammar | particle | conjugation
  content   jsonb not null,         -- LessonTeaching (see §2)
  primary key (lesson_id, section)
);
```

One row per taught section. Cascades with the lesson.

## 2. Shared types (`shared/src/types.ts`)

```ts
export type TeachingExample = {
  jp_ruby: string;   // furigana HTML, produced via toRubyHtml
  en: string;        // English translation
  note?: string;     // short English note, e.g. "は marks 私 as the topic"
};

export type LessonTeaching = {
  explanation: string;          // English explanation of the concept
  examples: TeachingExample[];  // worked examples
};

// LessonSectionDetail gains:
//   teaching: LessonTeaching | null
```

`teaching` is `null` for task sections and for old lessons without a row.

## 3. Generation

### gen package (`gen/src/`)

Add, mirroring the existing per-skill generators:

- `prompt.ts`: `TEACHING_SYSTEM` + `buildTeachingPrompt({ skill, topic, jlpt_level, avoid })`.
  The prompt asks for a concept explanation in English plus example sentences,
  and is given the `avoid` list (the check-card sentences) with the instruction
  to use **different** sentences while preparing the learner for those concepts.
  The **particle** variant additionally requires an English explanation of each
  particle's function and a contrast of the commonly confused ones.
- `parse.ts`: `parseTeaching(raw)` — validates the `{ explanation, examples[] }`
  shape, rejects malformed output (same style as the other parsers).
- `generate.ts`: `generateTeachingBatch({ skill, topic, jlpt_level, avoid, client, signal })`
  → `callWithRetry({ system, user, parse: parseTeaching, client })`. Returns the
  parsed teaching content (raw Japanese in examples) plus `usage`.
- `index.ts`: export the new function and types.

Ruby enrichment (`toRubyHtml` over each example's Japanese) happens in the server
service, matching the existing raw-JP-in-gen / enrich-in-server split.

### server (`server/src/services/lesson-generate.ts`)

```
const CONCEPT_SKILLS = new Set(['vocab','grammar','particle','conjugation']);

for (const skill of skills) {
  const r = await runGeneration({ skill, count, weakness_hint: hint });   // unchanged
  totalCost += r.cost_usd;
  // ...existing tag + lesson_items inserts...

  if (CONCEPT_SKILLS.has(skill)) {
    const avoid = r.items.map(sentenceOf);              // pull JP sentence per card
    const t = await generateTeachingBatch({ skill, topic, jlpt_level, avoid });
    totalCost += computeCost(t.usage);
    const examples = await Promise.all(t.examples.map(async (e) => ({
      jp_ruby: await toRubyHtml(e.jp), en: e.en, note: e.note,
    })));
    await pool.query(
      `insert into lesson_sections (lesson_id, section, content)
       values ($1,$2,$3) on conflict (lesson_id, section) do update set content = excluded.content`,
      [lessonId, skill, JSON.stringify({ explanation: t.explanation, examples })],
    );
  }
}
```

`generateLessonInto` still never throws; a teaching-generation failure records
the lesson `failed` via the existing catch. `sentenceOf` extracts the display
sentence per skill from the card `prompt` (the same fields `TeachLine` reads).

## 4. Detail endpoint (`server/src/services/lessons.ts`)

`getLessonDetail` LEFT JOINs `lesson_sections` (or does a second query keyed by
`lesson_id`) and attaches `teaching: LessonTeaching | null` to each
`LessonSectionDetail`. Section order and item mapping are unchanged.

## 5. Client (`client/src/components/LessonSection.tsx`)

Teach phase renders based on the new `teaching` field:

- `teaching` present → explanation paragraph + example list: `RubyText` for
  `jp_ruby`, the English line, and the optional note.
- `teaching` null **and** task skill → static per-skill task intro blurb
  (a small constant map, e.g. in `lib/skills.ts`).
- `teaching` null **and** concept skill → fall back to the current `TeachLine`
  scrape (old prod lessons).

The check phase and all card components are unchanged.

## 6. Testing

- `gen`: `parseTeaching` accepts a well-formed object and rejects malformed
  shapes (missing `explanation`, non-array `examples`, wrong field types).
- server: `generateLessonInto` (with a stub generator) writes `lesson_sections`
  rows for concept skills only, passes a non-empty `avoid` list, and accumulates
  teaching cost; `getLessonDetail` returns `teaching` for taught sections and
  `null` otherwise.
- Existing lessons e2e continues to pass via the fallback path.

## Non-goals

- No change to card generation, the check flow, the review queue, or practice.
- No backfill of teaching content for existing lessons.
- No new teaching content for task skills (reading/listening/explain).
