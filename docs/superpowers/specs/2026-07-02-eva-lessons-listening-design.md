# Design: Eva-trained lesson platform — Lessons + Listening Comprehension

**Status:** Design approved in brainstorming. This is the roadmap spec. Phase 1 is at
spec-ready depth; Phases 2–4 are roadmap altitude and get their own deepened specs when
reached. Next step: invoke writing-plans for Phase 1.

---

## Context

`nihongo-practice` today is a single-user, item-based spaced-repetition Japanese app. Every
card is an `items` row (`skill`, `prompt` jsonb, `answer` jsonb, `source`, `tags`) on a
5-box Leitner scheduler. Six skills exist (`vocab, grammar, reading, conjugation, particle,
explain`). Content is AI-generated (Anthropic Sonnet via `gen/`), furigana added by kuromoji,
cost tracked in USD. Auth is a single passcode. An outbound Hermes progress-event integration
is **designed but not yet built** (`docs/superpowers/specs/2026-06-28-hermes-progress-events-design.md`).

**The shift this design makes:** move the app's center of gravity from ad-hoc self-study to an
**Eva-trained, lesson-led experience**. Hermes-jester's agent **Eva** becomes the user's language
trainer: she *sees* daily study via the outbound Hermes event stream and *acts* by writing
directly to nihongo's API — tuning the plan, editing lessons, and generating new content within a
budget. The human's only knobs are an **initial JLPT level** and a **generation budget cap**; Eva
owns curriculum, topics, difficulty, pace, and level re-evaluation.

**Two-channel Eva loop** (Hermes is a one-way inbox — `GET /api/items?unread` + `POST /api/items/ack`;
it cannot carry writes back to the app):
- **Outbound (nihongo → hermes-jester):** lesson-progress + ad-hoc review events → hermes-jester items Eva polls/acks. How she *sees* progress.
- **Inbound (Eva → nihongo):** a bearer-authed write-API on nihongo. How she *acts* (plan/lesson/content CRUD + budget-capped generate).

**Product model:** the **lesson is the main experience** — pacing the user through Eva's curriculum.
**Eva owns the lesson plan itself**, not just its parameters: cadence/frequency (daily, every other
day, etc.), topic sequence, and per-lesson content volume — all tuned from observed progress.
**Ad-hoc self-study stays exactly as today**, demoted to a secondary "extra time" entry point. Both
report to Hermes.

**Assessments:** Eva can also create **tests** that validate understanding — a scored, lesson-like
grouping that **reuses the ad-hoc practice content** (existing `items`) as its questions rather than
generating fresh cards. Assessment results stream to Hermes and drive Eva's periodic JLPT-level
re-evaluation (raise/lower).

**Content-primitive invariant:** lessons and listening generate ordinary `items` (tagged +
linked to a lesson), so all lesson content is automatically consumable in the existing daily SRS
queue. No parallel content type — this is the key simplifying choice.

**Explicitly dropped:** content ingestion (web crawler + Google Docs OAuth). Eva sources content
externally and pushes it in through her write-API.

---

## Phase roadmap

| Phase | Deliverable | Independently shippable |
|---|---|---|
| **1 — Listening Comprehension** | Standalone 7th skill in daily practice | Yes |
| **2 — Lessons core + daily home** | AI lessons whose items feed the queue; home reoriented to "today's lesson" | Yes |
| **3 — Hermes progress streaming** | Eva can *see* everything (ad-hoc + lesson events) | Yes |
| **4 — Eva trainer API** | Eva can *act*: tune plan, edit content, generate (budget-capped) | Yes |

---

## Phase 1 — Listening Comprehension (spec-ready depth)

A 7th skill. One listening item = one audio clip + N multiple-choice questions. Usable in ad-hoc
daily practice immediately; Phase 2 lessons compose it for free.

### Data shapes (`shared/src/types.ts`)
- Extend `Skill` enum with `"listening"`.
- `ListeningPrompt`: `audio_url: string`, `audio_kind: "monologue" | "dialogue"`, `topic: string`,
  `jlpt_level: string` (e.g. `"N4"`), `questions: [{ question_english, options: string[4], answer_index: 0..3 }]` (2–4 questions).
- `ListeningAnswer`: `transcript_ruby: string` (furigana HTML, revealed after answering),
  `translation_english: string`, optional `question_explanations: string[]`.
- Extend the fixed 6-skill typed objects to 7: `DashboardResponse.by_skill`, `StatsBySkillResponse.by_skill`,
  `LibraryResponse.by_skill`.

### Migration
- New migration relaxing the `items.skill` CHECK constraint to include `'listening'` (mirrors
  `1780358400000_items_skill_explain.sql`).

### TTS + audio infra
- New OpenAI TTS client (new module, e.g. `gen/src/tts.ts` or `server/src/services/tts.ts`):
  synthesize MP3 from text, distinct voices per speaker for dialogue. Add `OPENAI_API_KEY` to
  `server/src/env.ts` + `.env.example` (optional; no-op/stub when unset, matching `NIHONGO_FAKE_AI`).
- TTS char-cost folded into the existing USD cost tracking (`gen/src/pricing.ts`).
- `AUDIO_DIR` config; write `<item_id>.mp3`; serve statically (express static in dev, nginx in prod).
  Document the nginx location block for prod (spruce-cedar server).

### Generation (`gen/`)
- New listening prompt/parse path: Claude writes script (dialogue alternates speakers) + MC
  questions + answer_index + transcript + translation → TTS synthesizes audio → `audio_url` set →
  transcript run through existing kuromoji furigana (`gen/src/furigana.ts`). Reuse the existing
  generate orchestration + batching in `gen/src/generate.ts`.
- Wire `listening` into `server/src/routes/generate.ts` and `services/generate.ts`.

### Grading
- MC answers are known → grade **locally** on the client like `particle` today (no LLM at grade
  time). Overall `got_it` when fraction correct ≥ 0.6 (mirrors `explain` threshold). Records via
  the existing `POST /api/reviews` path — no new grade endpoint.

### Client
- New `ListeningCard` component (audio player + sequential MC questions + reveal transcript/translation),
  wired into `PracticeScreen`/`SwipeDeck` alongside `MultipleChoiceCard`/`ProductionCard`.
- Extend `client/src/lib/skills.ts` and dashboard/stats/library screens for the 7th skill.

### Server display
- Extend `server/src/services/item-display.ts` (`itemDisplay(skill, prompt, answer)`) to derive
  front/reading/meaning for `listening` (drives Browse/Stats/Library + the future Hermes `front`/`meaning`).

### Tests (TDD)
- Types round-trip; parse of listening generation output; furigana on transcript; local MC grading
  threshold; item-display for listening; generate route accepts `listening`; TTS client is a no-op
  when unconfigured (mock fetch) and swallows errors.

---

## Phase 2 — Lessons core + daily home (roadmap altitude)

- **Model:** `lessons` (title, `kind: "lesson" | "assessment"`, topic, jlpt_level, grammar_focus,
  description, status, plan_id?, cost_usd, timestamps), `lesson_items` (lesson_id, item_id, position,
  section), `lesson_state` (progress: not_started/in_progress/completed, current position, per-section scores).
- **Assessments** are the same model with `kind = "assessment"`: their `lesson_items` link to
  **existing** `items` (reused ad-hoc content) rather than freshly generated cards, and completion
  yields an overall score. Guided flow renders them like a lesson but scored end-to-end.
- **Lesson generator:** orchestrates the existing per-skill generators into one topic/grammar bundle
  (vocab + grammar + reading passage + listening clip + explain task). Every generated row is a normal
  `items` row tagged `lesson:<id>` and linked via `lesson_items`.
- **API:** lessons list/detail/state; "today's lesson" resolution.
- **UI:** Lessons screen + guided walkthrough (sections in order once), then items live in the SRS queue
  for retention. Home reoriented to "Today's lesson"; ad-hoc self-study demoted to a secondary entry
  point (unchanged mechanics, same queue).
- Deepen into its own spec before building.

## Phase 3 — Hermes progress streaming (roadmap altitude)

- Build the existing outbound Hermes spec (`2026-06-28-hermes-progress-events-design.md`) and extend it:
  - Add `context: "ad_hoc" | "lesson"` (+ `lesson_id`, `section` when lesson) to `review_logged` events.
  - New `lesson_progress` sub-event: `started` / `section_completed` / `completed` (with scores);
    covers both `kind="lesson"` and `kind="assessment"` (assessment `completed` carries the overall
    score that feeds Eva's level re-evaluation).
- Fire-and-forget after commit, no-op when unconfigured, same as the existing spec. Eva now *sees* everything.
- Deepen into its own spec (extends the existing one) before building.

## Phase 4 — Eva trainer API (roadmap altitude)

- **Machine bearer auth:** new `MACHINE_API_KEY` middleware, distinct from the human passcode and from
  the outbound Hermes write key. New `server/src/middleware/machine-auth.ts` mirroring `passcode.ts`.
- **lesson_plan model:** Eva-owned (target JLPT level, **cadence/frequency** e.g. daily/every-other-day,
  curriculum/topic backlog, **per-lesson content volume**, skill emphasis, difficulty, pace,
  updated_by `eva`|`user`, updated_at). Human admin sets only **initial JLPT level** and **generation
  budget**; Eva tunes cadence/topic/volume from progress and re-evaluates level over time.
- **Write-API (bearer-authed):** full CRUD on the plan, lessons, and items; **create assessments** (build
  a `kind="assessment"` lesson by selecting existing items); plus a **budget-capped generate** endpoint
  so Eva can create new content. "Today's lesson" resolution (Phase 2) honors the plan's cadence.
- **Budget:** a **USD spend cap over a rolling window**, reusing the existing per-generation USD tracking
  (`generations` table / `gen/src/pricing.ts`). Eva's generate calls are refused past the cap.
- **Admin editor:** a small settings surface for the two human knobs (initial JLPT level + budget cap).
- Deepen into its own spec before building.

---

## Decisions locked

- One listening item = one clip + N MC questions, graded **locally** like `particle`; inside the existing
  one-item-one-result Leitner model.
- Lessons produce **real `items`**, not a parallel content type — makes lesson content free-to-consume in the daily queue.
- **No autonomous ingestion** in this program: crawler + Google Docs OAuth dropped; Eva sources content and pushes it in.
- **Budget = rolling-window USD spend cap** enforced on Eva's machine-authed generate calls (not an item-count quota).
- Human authors **no curriculum, cadence, or content volume** — only initial JLPT level + budget;
  Eva owns the rest (topic sequence, frequency, per-lesson volume, level re-evaluation).
- **Assessments reuse existing `items`** (no fresh generation) — a `kind="assessment"` lesson whose
  overall score feeds Eva's level re-evaluation.
- Hermes stays outbound-only; Eva's writes go **directly** to nihongo's bearer-authed API.

## Verification (per phase)

- **Phase 1:** `npm test` (shared/gen/server vitest) green for new listening tests; `npm run dev`
  (or `npm run dev:e2e` with `NIHONGO_FAKE_AI=1`) → generate a listening batch → practice a card:
  audio plays, MC grading records a review, transcript reveals with furigana; Browse/Stats/Library
  show the 7th skill. `npm run e2e` for the practice flow. Deploy the branch to exe.dev for live audio testing.
- **Phases 2–4:** verification defined in each phase's deepened spec.

---

## Next step

1. Invoke the writing-plans skill to turn **Phase 1** into a detailed implementation plan.
