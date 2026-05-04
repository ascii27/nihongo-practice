# Nihongo Practice — Design Spec

**Date:** 2026-05-04
**Status:** Approved for planning
**Owner:** michael.roy.galloway@gmail.com

## Goal

A mobile-first web app the owner uses daily on iPhone to drill Japanese across five skills: vocabulary in sentences, grammar/sentence patterns, reading comprehension, verb conjugation, and particle usage. Spaced repetition surfaces weak items; progress is saved server-side. Kanji renders with furigana above.

The app is built and used by a single person. It is not multi-tenant.

## Non-goals (v1)

- Multi-user accounts, sharing, or social features
- Audio, images, video
- Offline-first sync. Online-during-review is fine.
- Editing items in the UI (Phase 2)
- AI-driven content generation (Phase 1.5, after the core review loop is solid)

## Stack

- **Client:** Vite + React + TypeScript, mobile-first PWA (web manifest + service worker for "Add to Home Screen")
- **Server:** Express on Node.js 24 (LTS) + TypeScript. One process serves the API and the built client static assets.
- **Database:** PostgreSQL. Migrations as raw `.sql` files run by `node-pg-migrate` (or equivalent).
- **Tests:** Vitest (unit + API integration), Playwright (E2E against the deployed environment).
- **Hosting:** exe.dev VM at `spruce-cedar.exe.xyz`. Postgres runs alongside the app (managed Postgres on exe.dev preferred if available; otherwise a local instance on the same VM).

Shared types live in `shared/types.ts` so client and server agree on API contracts.

## Repo layout

```
nihongo-practice/
  client/        Vite + React + TS PWA
  server/        Express + TS API; serves client/dist in prod
  shared/        types.ts (Zod schemas + inferred types) consumed by both
  db/            SQL migration files
  seed/          Imported source content + import scripts
  e2e/           Playwright tests
  docs/          This spec and future design docs
```

Single repo so a feature PR can atomically touch client, server, migration, and tests.

## Workflow

- All feature work happens on a branch named `feat/<short-name>` or `fix/<short-name>`.
- Each branch opens a PR; the owner manually merges after review.
- Merged changes are deployed to `spruce-cedar.exe.xyz` for validation. Deployment mechanics will be defined when the deploy story is implemented (see Phase 0).
- Playwright smoke tests run per-PR; full E2E suite runs nightly against the deployed URL.

## Authentication

Single shared passcode. The owner enters the passcode once on a device; the client stores it in `localStorage` and sends it on every API request as an `X-Passcode` header. Server middleware constant-time compares against `PASSCODE` env var. Wrong/missing passcode → 401, client clears storage and shows the passcode screen.

No users table, no email flow, no sessions to manage server-side.

## Data model

Six tables. PostgreSQL.

```sql
items (
  id           uuid pk default gen_random_uuid(),
  skill        text not null check (skill in ('vocab','grammar','reading','conjugation','particle')),
  prompt       jsonb not null,
  answer       jsonb not null,
  source       text not null check (source in ('seed','ai','user')),
  tags         text[] not null default '{}',
  created_at   timestamptz not null default now()
)

review_state (
  item_id          uuid primary key references items(id) on delete cascade,
  box              smallint not null default 1 check (box between 1 and 5),
  next_review_at   timestamptz not null default now(),
  last_reviewed_at timestamptz,
  total_reviews    int not null default 0,
  total_missed     int not null default 0
)

reviews (
  id           bigserial primary key,
  item_id      uuid not null references items(id),
  reviewed_at  timestamptz not null default now(),
  result       text not null check (result in ('got_it','missed')),
  box_before   smallint not null,
  box_after    smallint not null,
  session_id   uuid references sessions(id),
  unique (item_id, reviewed_at)  -- idempotency for retried submissions
)

sessions (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  skill_filter  text  -- nullable; null = mixed
)

generations (
  id            uuid primary key default gen_random_uuid(),
  prompt_text   text not null,
  response_raw  jsonb not null,
  items_created int not null default 0,
  cost_usd      numeric(10,4),
  created_at    timestamptz not null default now()
)
```

### `prompt`/`answer` shapes per skill

Validated by Zod schemas in `shared/types.ts`. Each schema has a discriminator on `skill`.

```ts
// vocab — recall a word's meaning, in context
prompt: { sentence_ruby: string; target: string; sentence_english: string }
answer: { meaning: string; reading: string; notes?: string }

// grammar — recognize a sentence pattern's meaning
prompt: { sentence_ruby: string; pattern: string; sentence_english: string }
answer: { explanation: string; another_example_ruby?: string }

// reading — comprehend a short passage
prompt: { passage_ruby: string; question_english: string }
answer: { answer_english: string; answer_japanese_ruby?: string }

// conjugation — produce a specific conjugated form (typed input)
prompt: { base: string; base_ruby: string; tense: string }  // e.g. tense="past polite negative"
answer: { expected: string; expected_ruby: string; alternates?: string[] }

// particle — pick the right particle (multiple choice)
prompt: { sentence_ruby_blanked: string; options: string[]; answer_index: number }
answer: { explanation: string }
```

Furigana is stored inline as HTML `<ruby>kanji<rt>kana</rt></ruby>` per the technique at https://www.lorenzovainigli.com/blog/how-to-add-furigana-html/. The client renders it through a single `<RubyText>` component that sanitizes input with a strict allowlist of `<ruby>`, `<rt>`, `<rp>` only.

## Spaced repetition: Leitner

Five boxes with intervals: **1 day, 3 days, 7 days, 14 days, 30 days**.

- New item: starts in box 1, `next_review_at = now()`.
- Got it: `box = min(box+1, 5)`, `next_review_at = now() + interval(box)`.
- Missed: `box = 1`, `next_review_at = now() + 1 day`.

`reviews` is append-only. The current Leitner schema can be swapped to SM-2 or FSRS later by adding columns to `review_state` and replaying `reviews` if needed.

## API

All endpoints require `X-Passcode`. JSON bodies. Errors: `{ error: string, code: string }`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/check` | Validate the passcode (used on first load to bounce to the passcode screen if wrong). |
| `GET`  | `/api/queue?skill=&limit=20` | Items due for review. Filter by skill or null for mixed. Orders by `next_review_at` ASC. If empty and `include_new=true`, returns N new items with no `review_state` row. |
| `POST` | `/api/reviews` | Submit one review. Body: `{ item_id, result, reviewed_at, session_id? }` where `reviewed_at` is an ISO timestamp generated client-side. Updates `review_state`, inserts `reviews`. Idempotent: the unique constraint on `(item_id, reviewed_at)` makes a retried submission a no-op (server returns the existing state). Returns updated state. |
| `POST` | `/api/sessions` | Start a session. Body: `{ skill_filter? }`. Returns `{ id }`. |
| `PATCH`| `/api/sessions/:id` | End a session. Body: `{ ended_at }`. |
| `GET`  | `/api/items?skill=&search=&limit=&offset=` | Browse screen. Returns items with their review_state. |
| `GET`  | `/api/stats` | Dashboard: streak, items per box, accuracy over last 30 days. |
| `POST` | `/api/generate` | (Phase 1.5) Generate new items via Claude API. Body: `{ skill, count, weakness_hint? }`. Returns `{ items_created }`. |

## Screens

Five screens. Bottom tab bar on mobile.

1. **Today** — count of due items, big "Start review" button, current streak.
2. **Practice** — pick a skill (or "All due") then enter the session loop.
3. **Browse** — searchable list of all items, filterable by skill/box/tag. (Item editing is Phase 2.)
4. **Stats** — streak, items per Leitner box, accuracy over time.
5. **Settings** — passcode reset, AI key (Phase 1.5), data export.

### Session loop

1. `GET /api/queue` → array of items.
2. Render the appropriate card component:
   - `<FlipCard>` for vocab / grammar / reading: prompt → tap reveals answer → "Got it" / "Missed".
   - `<MultipleChoice>` for particle: 4 options → tap → auto-grade → "Next".
   - `<TypedInput>` for conjugation: input + Japanese keyboard hint → submit → exact match (with hiragana/katakana normalization) → "Got it" / "Missed" override available.
3. Optimistic UI: advance to next card immediately; queue the `POST /api/reviews` locally and retry on failure.
4. End of queue → summary screen with counts.

## AI top-up (Phase 1.5)

Manual trigger only — a "Generate more practice" button in Settings. Server-side, the request body shapes a Claude API prompt asking for N items in a strict JSON schema (matching the per-skill shapes above), with `<ruby>` furigana inline. Items are inserted with `source='ai'`. The full request and response are logged to `generations` for debugging and cost tracking. No background generation, no auto-retry.

Default provider: Anthropic Claude API. The model and key are configured via env vars on the server.

## UI design quality

The client is a tool the owner uses daily on iPhone. UI quality matters. **At the start of client implementation, invoke the `frontend-design` skill** to produce a distinctive, production-grade interface — not a generic AI-dashboard look. Constraints to honor:

- One-handed thumb reach: primary actions in the lower half of the screen.
- High contrast for furigana legibility; furigana ~50–60% of base font size; comfortable line height.
- Minimal chrome during a session — the card is the interface.
- Dark mode by default (eye comfort during evening practice). Light mode supported.
- iOS-safe-area aware (notch + home indicator).

## Errors and edge cases

- **Network failure mid-session:** queue reviews in IndexedDB, retry on next online event. Server is idempotent on `(item_id, reviewed_at)`.
- **Server cold-start / 502:** client shows "reconnecting…" toast and retries with exponential backoff.
- **Malformed furigana HTML:** sanitizer rejects → fall back to rendering plain kanji.
- **AI generation failure:** persist the raw response, return error count to client. No retry loop.
- **Empty queue, no new items:** show "All caught up — come back tomorrow" or prompt to generate (Phase 1.5).
- **Wrong passcode:** 401 → client clears localStorage and bounces to passcode screen.
- **Clock skew:** server is source of truth for `next_review_at`. Client never computes intervals.

Explicitly **not** handled in v1: full offline-first sync, multi-device conflict resolution.

## Testing

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | Leitner promotion math, furigana sanitizer, AI response parser, query builders. |
| API integration | Vitest + supertest, real Postgres in Docker | Every endpoint: queue ordering, review submission, idempotency, generation insert. No DB mocks. |
| E2E | Playwright (mobile viewport `iPhone 14`) | Critical paths only: passcode login → session → answer one of each card type → submit → verify queue updates. Smoke per-PR, full suite nightly. |

Server SRS logic is written test-first. React components without logic don't get unit tests; Playwright covers the flow.

## Phasing

- **Phase 0 — Bootstrap:** repo scaffold, Postgres up locally, deploy pipeline to `spruce-cedar.exe.xyz`, passcode auth, an empty session screen that loads.
- **Phase 1 — Core review loop:** items table, Leitner state machine, all five card components, queue + reviews endpoints, seed import script, your existing content imported. The app is usable end-to-end.
- **Phase 1.5 — AI top-up:** `/api/generate` endpoint, settings UI, generations table, cost tracking.
- **Phase 2 — User authoring:** add/edit items in Browse, manual review of AI-generated items before they enter the queue.

Each phase ends with a green Playwright run against the deployed environment.

## Open questions for plan time

- Exact deploy mechanism on exe.dev (Docker? plain Node + systemd?) — resolved during Phase 0 with the `using-exe-dev` skill.
- Postgres on exe.dev: managed vs self-hosted — same as above.
- Seed content schema — defined when we look at the actual files in Phase 1.
