# Design: Lessons core + daily-lesson home (Phase 2)

**Status:** Design approved in brainstorming (2026-07-03). Deepens Phase 2 of the
Eva-trained lessons roadmap (`docs/superpowers/specs/2026-07-02-eva-lessons-listening-design.md`)
into a buildable spec. Next step: writing-plans.

---

## Context

Phase 1 shipped: the app has 7 skills (`vocab, grammar, reading, conjugation,
particle, explain, listening`), each generating ordinary `items` rows (Anthropic
via `gen/`, furigana via kuromoji, listening via OpenAI TTS), all riding a 5-box
Leitner queue. Everything is item-based; there is no grouping concept above the
item yet.

Phase 2 adds the **lesson layer**: an AI-generated bundle of items around one
topic/grammar point, consumed through a guided teach→check walkthrough, after
which the items live in the normal SRS queue for retention. The home screen
reorients around a **daily lesson** as the main experience, with ad-hoc
self-study demoted to a secondary "extra time" entry.

**Phase ordering note:** the lesson *plan* and Eva's write-API (which own topic,
cadence, and lesson creation) are **Phase 4**. So Phase 2 ships an **interim,
self-serve manual create-lesson form**; Phase 4 later points Eva at the same
generator. **Assessments** (`kind='assessment'`) are **deferred to Phase 4** (when
Eva creates them and level re-evaluation consumes their scores) — Phase 2 only
reserves the `kind` column.

**Core invariant (unchanged):** a lesson never invents a new content primitive.
Every generated card is an ordinary `items` row (tagged `lesson:<id>`,
`source='ai'`) linked via `lesson_items`. Lesson content therefore flows into the
existing SRS queue for free and renders with the existing cards.

---

## Data model (3 new tables)

```
lessons
  id           uuid pk
  title        text
  kind         text not null default 'lesson' check (kind in ('lesson','assessment'))
  topic        text not null
  jlpt_level   text not null                 -- 'N5'..'N1'
  skills       text[] not null               -- chosen skills, in section order
  status       text not null default 'generating'
                 check (status in ('generating','ready','failed'))
  error        text
  cost_usd     numeric not null default 0
  created_at   timestamptz not null default now()
  generated_at timestamptz                   -- set when status → ready

lesson_items
  lesson_id  uuid  references lessons(id) on delete cascade
  item_id    uuid  references items(id) on delete cascade
  section    text  not null                  -- the skill, e.g. 'vocab'
  position   int   not null                  -- order within the section
  primary key (lesson_id, item_id)

lesson_state
  lesson_id       uuid pk references lessons(id) on delete cascade
  status          text not null default 'not_started'
                    check (status in ('not_started','in_progress','completed'))
  current_section text                        -- skill of the section in progress
  current_index   int  not null default 0     -- position within walkthrough
  started_at      timestamptz
  completed_at    timestamptz
```

Single-user app → one `lesson_state` row per lesson. Generated items keep their
`lesson:<id>` tag so Browse/Stats can attribute them.

---

## Lesson generation (async, in-process)

- `POST /api/lessons { topic, jlpt_level, skills[] }` inserts the `lessons` row as
  `status='generating'`, returns immediately (`{ id, status }`), and starts an
  **in-process background task** — the same fire-and-forget pattern the Hermes
  design uses. No external queue; fits the single-server PM2 app.
- The task (`server/src/services/lesson-generate.ts`) is a thin **orchestration
  layer over Phase 1's `runGeneration`**: for each chosen skill it runs the
  existing per-skill generation (passing `topic`/`jlpt_level` into the existing
  `weakness_hint`/level inputs), tags each created item `lesson:<id>`, inserts the
  `lesson_items` rows in section+position order, and accumulates `cost_usd`. No
  new per-skill generation code — listening reuses the Phase 1 TTS path.
- On success: `status='ready'`, `generated_at=now()`, `cost_usd` set. On any
  failure: `status='failed'`, `error` set (partial items already inserted are left
  attributed to the lesson; a failed lesson is not surfaced as "today's lesson").
- Reuses per-skill count defaults (small per section, e.g. vocab 5 / grammar 3 /
  reading 1 / listening 1 / explain 1 — final counts fixed in the plan).

**Why async:** 5 generators + TTS is ~1–2 min; a background task + `status`
column + client polling keeps create responsive and survives a dropped
connection.

---

## Guided walkthrough (teach → check, per section)

Sections run in the lesson's `skills` order. Each section is two beats:

1. **Teach** — the section's items shown face-up as study material (front +
   answer, via the existing display helpers / `RubyText`). For listening this is a
   brief "listen" intro; for particle/conjugation a short framing — their card
   already reveals the answer.
2. **Check** — the section's items run as their **normal graded cards**, reusing
   the existing components (`FlipCard`, `MultipleChoiceCard`, `TypedInputCard`,
   `ProductionCard`, `ListeningCard`). Grades post via the existing
   `POST /api/reviews`, seeding `review_state` exactly as ad-hoc practice does.

Progress persists to `lesson_state` (`current_section`/`current_index`) so a
half-finished lesson resumes where it left off. Finishing the last section sets
`status='completed'`, `completed_at`. After completion the lesson's items are just
normal due/new cards in the queue.

New client surface: a `LessonWalkthrough` screen composing existing cards; a
per-skill lightweight "study/teach" view.

---

## "Today's lesson" resolution (Phase 2 — no plan/cadence yet)

`GET /api/lessons/today` returns, in order of preference:
1. the `in_progress` lesson, if any;
2. else the oldest `ready` + `not_started` lesson;
3. else `null` (→ home shows a **Create a lesson** CTA, or "Preparing your
   lesson…" if a lesson is currently `generating`).

No hard one-per-day gate — cadence/frequency is Phase 4 (Eva-owned). Completing
today's lesson simply surfaces the next `ready` one.

---

## Home reorientation + Lessons screen

- **`DashboardScreen`** gains, top to bottom: a **Today's-lesson hero** (title,
  level, section chips, Start/Resume CTA — or the create/preparing states above),
  a **"Reviews due (N)"** distinct secondary row (the existing queue, retention),
  an **ad-hoc practice** entry, and the streak. Composes with the in-flight Ink &
  Stone "Hero Today" redesign (this spec defines the information architecture, not
  final styling).
- **New Lessons screen** — a list of lessons with status badges
  (generating/ready/failed/completed) + the **create-lesson form** (topic input,
  JLPT level select, skill checkboxes). Reachable from the bottom tabs.

---

## API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/lessons` | Create a lesson + kick off async generation. Body `{ topic, jlpt_level, skills[] }` → `{ id, status }`. |
| GET | `/api/lessons` | List lessons (id, title, topic, level, status, lesson_state status, counts). |
| GET | `/api/lessons/:id` | Detail: lesson + items grouped by section (skill) in order. |
| GET | `/api/lessons/:id/status` | Lightweight `{ status, error? }` for polling during generation. |
| GET | `/api/lessons/today` | Today's-lesson resolution (above). |
| PATCH | `/api/lessons/:id/state` | Update walkthrough progress `{ status, current_section, current_index }`. |

All behind the existing passcode middleware. New Zod schemas in
`shared/src/types.ts`. Migration adds the three tables (node-pg-migrate SQL, same
pattern as existing migrations).

---

## Decisions locked

- Manual create-lesson form in Phase 2; Eva points at the same generator in Phase 4.
- Lessons generate **real `items`** (tagged `lesson:<id>`), never a parallel content type.
- Assessments deferred to Phase 4; only the `kind` column is reserved now.
- Generation is **async in-process** (status + polling), reusing `runGeneration`; no external queue.
- Walkthrough is **teach → check per section**; the check reuses existing graded cards and the existing `/api/reviews` path (first pass seeds SRS normally).
- **No daily cadence gate** in Phase 2 — "today's lesson" is just next-up resolution; cadence is Phase 4.
- Home: **lesson hero + distinct "reviews due" secondary** + ad-hoc + streak.

---

## Testing / verification

- **Local (no DB):** unit tests for the lesson-generate orchestration under
  `NIHONGO_FAKE_AI=1` (correct sections/items/tags, cost summed, status
  transitions, failure path), today's-lesson resolution, and `lesson_state`
  transitions; shared type round-trips; full `npm run build`.
- **CI/exe.dev (DB + browser):** route tests (create → generating → ready;
  detail grouping; today resolution; state PATCH) and an e2e that, under
  `NIHONGO_FAKE_AI=1`, creates a lesson, waits for `ready`, walks the teach→check
  flow to completion, and asserts the lesson's items then appear as due/new in the
  practice queue. Live check on exe.dev (real generation + TTS).

---

## Next step

Invoke the writing-plans skill to turn this into a task-by-task implementation plan.
