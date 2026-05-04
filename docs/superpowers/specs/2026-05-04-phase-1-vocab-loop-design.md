# Phase 1 — Vocab Review Loop, End-to-End

**Date:** 2026-05-04
**Status:** Approved for planning
**Owner:** michael.roy.galloway@gmail.com
**Parent spec:** [`2026-05-04-nihongo-practice-design.md`](./2026-05-04-nihongo-practice-design.md)

## Goal

Make the app usable for daily vocab review. The owner opens it on iPhone, sees today's due count, taps Start, flips through cards (Got it / Missed), and progress is saved. Spaced repetition surfaces weak items. The ~300 vocab cards from the existing XML deck are imported with Claude-generated example sentences and kuromoji-generated furigana.

This is a deliberate scope-down of "Phase 1" as written in the parent spec: only the **vocab** skill ships. Grammar, reading, conjugation, and particle skills become later increments — each one a small, well-bounded addition (one card component + import strategy) on top of the loop built here.

## Non-goals

- Other four skills (grammar, reading, conjugation, particle) — deferred.
- PDF extraction — deferred. The XML deck is the only seed source for Phase 1.
- AI top-up endpoint (`POST /api/generate`) — Phase 1.5.
- Browse / full Stats / Settings screens — bottom-tab placeholders only.
- Editing items in the UI — Phase 2.
- IndexedDB offline review queue — in-memory retry only; lost reviews on tab close are acceptable.

## Architecture

Builds on the Phase 0 monorepo. New code in three places, plus one new workspace:

- `db/migrations/` — one SQL file adding `items`, `review_state`, `reviews`, `sessions` plus the seed-idempotency unique constraint.
- `server/src/{routes,services,db}/` — queue / reviews / sessions endpoints, Leitner state machine, item DAO.
- `client/src/{screens,components,api}/` — Today + Practice screens, `<FlipCard>`, `<RubyText>`, bottom tab nav (Browse / Stats stubs), API hooks.
- `seed/` (new workspace) — one-shot Node script to import the XML deck. Not part of the running app.

Existing Phase 0 plumbing (npm workspaces, passcode middleware, design tokens, CI, deploy script, Playwright smoke) is unchanged.

## Data model

The four tables from the parent spec, with **one addition**: `items.external_id` and a `unique (source, external_id)` constraint to make the seed importer idempotent.

```sql
items (
  id          uuid pk default gen_random_uuid(),
  skill       text not null check (skill in ('vocab','grammar','reading','conjugation','particle')),
  prompt      jsonb not null,
  answer      jsonb not null,
  source      text not null check (source in ('seed','ai','user')),
  external_id text,                          -- xml card id for seed; null for AI/user
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  unique (source, external_id)
);

review_state (
  item_id          uuid primary key references items(id) on delete cascade,
  box              smallint not null default 1 check (box between 1 and 5),
  next_review_at   timestamptz not null default now(),
  last_reviewed_at timestamptz,
  total_reviews    int not null default 0,
  total_missed     int not null default 0
);

reviews (
  id           bigserial primary key,
  item_id      uuid not null references items(id),
  reviewed_at  timestamptz not null,
  result       text not null check (result in ('got_it','missed')),
  box_before   smallint not null,
  box_after    smallint not null,
  session_id   uuid references sessions(id),
  unique (item_id, reviewed_at)
);

sessions (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  skill_filter  text
);
```

The `generations` table from the parent spec is **not** added in Phase 1. It lands with the AI top-up endpoint in Phase 1.5.

### Vocab `prompt` / `answer` shape

Validated by a Zod schema in `shared/src/types.ts`:

```ts
prompt: { sentence_ruby: string; target: string; sentence_english: string }
answer: { meaning: string; reading: string }
```

`sentence_ruby` is HTML containing only `<ruby>`, `<rt>`, `<rp>` tags. `target` is the bare term as it appears in `sentence_ruby` (used for visual emphasis). `reading` is the kana reading of `target`. Other-skill schemas are not added in Phase 1.

## API

All endpoints require `X-Passcode`. JSON bodies. Errors: `{ error: string, code: string }`.

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| `GET`  | `/api/queue?skill=&limit=` | — | `{ due: Item[], new: Item[] }`. `due` is items with `review_state.next_review_at <= now()`, ordered ASC. `new` (items with no `review_state` row) is **only** populated when `due.length < 10`, capped at 10. `skill` query param is accepted but only `vocab` is supported in Phase 1; other values return 400. `limit` caps `due.length` (default 100). |
| `POST` | `/api/sessions` | `{ skill_filter? }` | `{ id }` |
| `PATCH`| `/api/sessions/:id` | `{ ended_at }` | `{ ok: true }` |
| `POST` | `/api/reviews` | `{ item_id, result, reviewed_at, session_id? }` | `{ box, next_review_at, total_reviews, total_missed }`. Idempotent on `(item_id, reviewed_at)` — retried submissions return the existing state. |
| `GET`  | `/api/stats/streak` | — | `{ days: number }`. Computed from `reviews.reviewed_at` grouped by **device-local-midnight** — the client passes its IANA timezone via `?tz=` query param; server uses it for the `date_trunc('day', reviewed_at AT TIME ZONE tz)` grouping. |

`GET /api/items`, full `GET /api/stats`, `POST /api/generate` are out of scope for Phase 1.

## Spaced repetition: Leitner state machine

Pure function `nextState(prev, result, now)` in `server/src/services/leitner.ts`. Test-first.

- Intervals: **1, 3, 7, 14, 30 days** for boxes 1–5.
- New (no `prev`): result `got_it` → `box=1, next_review_at=now+1d`. Result `missed` → `box=1, next_review_at=now+1d`. (New items always start review the day after first exposure regardless of first result; the first attempt is "exposure," not graded.)
- Existing, `got_it`: `box = min(prev.box+1, 5)`, `next_review_at = now + interval(box)`, `total_reviews += 1`.
- Existing, `missed`: `box = 1`, `next_review_at = now + 1d`, `total_reviews += 1`, `total_missed += 1`.

`reviews` is append-only. Replaying it can rebuild `review_state` if we ever swap to SM-2 / FSRS.

## Session mechanics

- **Size:** all due items in one session (no fixed N). Session ends naturally when the queue drains.
- **New items:** when `due.length < 10`, the queue endpoint mixes in up to 10 new items (no `review_state` row). Hard-coded constant `NEW_PER_DAY = 10`. With 300 cards this finishes the deck in ~30 days; steady state is review only.
- **Streak:** ≥1 review counts as a completed day. Day boundary = device-local midnight. Computed by the server's `/api/stats/streak` endpoint using a client-supplied IANA timezone (e.g. `America/New_York`).

## Seed import pipeline

New workspace `seed/` with one entry point: `npm --workspace seed run import -- <absolute-xml-path>`.

Source: `/Users/michaelgalloway/Library/Mobile Documents/com~apple~CloudDocs/Personal study.xml` (kept outside the repo).

Steps:

1. **Parse XML** with `fast-xml-parser`. Extract `[{ external_id, japanese, english }]` per `<card>`.
2. **Filter already-seeded** by `SELECT external_id FROM items WHERE source='seed' AND external_id = ANY($1)`.
3. **Batched Claude generation** — `claude-sonnet-4-6`, 20 cards per call, JSON-mode response with strict schema. Prompt asks for one natural example sentence per word in everyday Japanese, plus the English translation. Failed batches are retried up to 2× before being logged and skipped. Per-batch cost is logged.
4. **Furigana pass** — for each generated `sentence_japanese`, run `kuromoji` to tokenize and produce `<ruby>kanji<rt>kana</rt></ruby>` markup → `sentence_ruby`. Same kuromoji pass derives `reading` (kana of `target`) for the answer.
5. **Insert** with `ON CONFLICT (source, external_id) DO NOTHING`. `prompt = { sentence_ruby, target: japanese, sentence_english }`, `answer = { meaning: english, reading }`.
6. **Report** — totals: parsed / inserted / skipped-existing / failed-batches / total-cost-USD.

Each batch is one DB transaction so a failure leaves no half-seeded rows. The script is idempotent: re-running it inserts only newly-added cards or skipped failures.

The Anthropic API key is read from `ANTHROPIC_API_KEY` env var. The script is **not** invoked at server startup or by CI — it's run manually by the owner once when seeding.

## Client

### Navigation

A 4-tab bottom bar (Today / Practice / Browse / Stats). Browse and Stats render a "Coming soon" placeholder. Settings is reachable from a small link in the Today topbar (sign out lives there too, replacing the placeholder from Phase 0). The visual chrome is right; the engineering is focused on Today + Practice.

### Today screen

On mount, fetch `/api/queue` (for the due count) and `/api/stats/streak` in parallel. Layout:

- Topbar: app title, sign-out link.
- Hero: big due-count number + "cards due", streak below.
- Primary action: "Start review" button in the lower thumb zone. Disabled when due count is 0 and no new items would be surfaced.
- Empty state: "All caught up — come back tomorrow."

### Practice screen

On mount: `POST /api/sessions` → store `session_id`. Then `GET /api/queue` → array `[...due, ...new]`.

For each item, render `<FlipCard>`:

- **Prompt face:** `<RubyText html={prompt.sentence_ruby} />` with `prompt.target` visually emphasized (bold + accent color). Below the sentence, "Tap to reveal" hint.
- **Answer face (after tap):** `prompt.target` large, `answer.reading` in furigana-style above, `answer.meaning` below the sentence. The original sentence remains visible above for context. Plus `prompt.sentence_english`.
- **Buttons (thumb zone):** "Missed" (left) and "Got it" (right). Tapping either: optimistically advance to next card; in the background `POST /api/reviews` with `{ item_id, result, reviewed_at: <client ISO now>, session_id }`. Retry up to 3× with backoff on failure. On final failure, surface a non-blocking toast — don't roll back the UI.

End of queue → summary screen: "X cards reviewed, Y missed", a "Done" button → `PATCH /api/sessions/:id` with `ended_at`, navigate back to Today.

### Components

- `<FlipCard>` — flip animation (CSS transform), prompt → answer states.
- `<RubyText html={string} />` — sanitizes input via an allowlist of `<ruby>/<rt>/<rp>` only (no attributes, no other tags). Falls back to plain text on rejection.

### Visual treatment

The `frontend-design` skill is invoked at the start of client work to produce the visual treatment for FlipCard, Today's hero, and the bottom tab bar — building on the v0 design tokens shipped in Phase 0. The skill output guides component CSS; component logic and tests are written separately.

## Errors and edge cases

- **Wrong passcode mid-session:** `POST /api/reviews` returns 401 → existing client `AuthError` handling clears localStorage and bounces to passcode screen. In-flight pending reviews are dropped.
- **Server 5xx on review submit:** retry 3× with exponential backoff; toast on final failure, do not roll back the UI. The card has already been advanced; the user's already moved on.
- **Empty queue with no new items:** Today screen shows "All caught up." Practice screen, if reached anyway, shows the same.
- **Malformed `sentence_ruby` HTML:** `<RubyText>` sanitizer rejects → renders the sanitized text (kanji visible, no furigana).
- **Clock skew:** client passes `reviewed_at` as an ISO timestamp; server stores it as-is for two purposes: (1) the `(item_id, reviewed_at)` idempotency key, and (2) streak day-grouping. The Leitner math computes `next_review_at` from the **server's** clock (`now()` at the moment the review is processed). The client never computes intervals. A small client clock skew (seconds to minutes) is harmless because Leitner intervals are days.
- **Streak across timezones:** the client passes its current IANA timezone on every `/api/stats/streak` call. Travel changes the answer; the owner is fine with this.

## Testing

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | `nextState` (every box transition + new-item case + edge cases at box=5 and box=1), `<RubyText>` sanitizer (allowlist enforcement, rejection fallback), seed importer's XML parser, Claude JSON-response parser. |
| API integration | Vitest + supertest, real Postgres in Docker | `/api/queue` ordering and new-item threshold, `/api/reviews` idempotency on duplicate `(item_id, reviewed_at)`, session start/end, streak computation across timezones. No DB mocks. |
| E2E | Playwright (iPhone 14 viewport) | Extend Phase 0 smoke: passcode → Today shows due count > 0 (after a test fixture seeds a few items) → tap Start → answer one card "Got it" → queue advances → finish session → back to Today with due count decremented. Run against local stack in CI; nightly against deployed URL. |

The seed importer's Claude integration is **not** tested live in CI — too slow, costs money. The JSON-response parser is unit-tested with fixture responses; the orchestration is exercised manually when the owner imports their deck.

## Migrations and deploy

- One new migration file adds the four tables.
- Production deploy follows the existing `scripts/deploy.sh` from Phase 0: build, ship, run `npm --workspace server run db:migrate`, restart pm2.
- The seed import is run manually by the owner (locally against the production DB, or via SSH on the VM with the XML file copied over) — not part of the deploy pipeline.

## What ships at the end of Phase 1

The owner can open `https://spruce-cedar.exe.xyz` on iPhone, enter the passcode, see "300 cards due" on day one, tap Start, drill through vocabulary with example sentences and furigana, mark each card, and have progress saved. Tomorrow they come back and only the cards they should be reviewing are due.

The four other skills are the next four small phases.
