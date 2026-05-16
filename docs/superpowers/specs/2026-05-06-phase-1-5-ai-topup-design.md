# Phase 1.5 — AI Top-Up

**Date:** 2026-05-06
**Status:** Approved for planning
**Owner:** michael.roy.galloway@gmail.com
**Parent spec:** [`2026-05-04-nihongo-practice-design.md`](./2026-05-04-nihongo-practice-design.md)
**Predecessor:** [`2026-05-04-phase-1-vocab-loop-design.md`](./2026-05-04-phase-1-vocab-loop-design.md)

## Goal

Let the owner top up the deck with AI-generated vocab on demand. Two manual triggers: a "Generate vocab" widget on a real Settings screen, and a compact form on the Today empty state ("All caught up — generate more?"). Each generation calls Claude, validates JSON, adds furigana with kuromoji, inserts items with `source='ai'`, and writes a `generations` audit row capturing the prompt, response, token usage, and cost.

Phase 1 shipped only vocab; Phase 1.5 stays vocab-only. Other skills do not enter the picture here — they remain a future increment.

## Non-goals

- Other four skills (grammar, reading, conjugation, particle).
- AI key UI for setting/rotating the credential. The key remains in the VM `.env`; Settings shows a read-only status pill.
- Manual review gate for AI items before they enter the queue (Phase 2).
- Auto-derived weakness hints from review history (free-form textbox only in Phase 1.5).
- Background generation, scheduled top-ups, or auto-retry beyond the existing per-batch retries inside `generateBatch`.
- Per-item edit/delete in the UI (Phase 2).
- Concurrency control — only one user, who isn't going to race themselves.

## Architecture

A new workspace package `@nihongo/gen` extracts everything Claude- and kuromoji-related so both the existing seed importer and the new `/api/generate` route share one implementation.

```
gen/
  src/
    prompt.ts       buildVocabPrompt({ count, weakness_hint })
    parse.ts        parseBatchResponse(raw)              // strips ```json fences
    furigana.ts     toRubyHtml, readingFor, getTokenizer  // kuromoji singleton
    pricing.ts      MODEL, INPUT_PER_MTOK, OUTPUT_PER_MTOK, computeCost(usage)
    generate.ts     generateBatch({ count, weakness_hint, client? })
  src/*.test.ts
```

The seed package keeps `import.ts` (CLI: parse XML → call gen → insert into DB) and `parse-xml.ts`. The prompt, parse, furigana, and generate-batch code moves under `gen/`. The shared package stays lean — still just zod schemas + sanitize, safe for the client bundle.

Server changes:

```
server/src/
  routes/generate.ts         POST /api/generate
  routes/generations.ts      GET  /api/generations
  routes/settings.ts         GET  /api/settings/status   // ai_key_configured
  services/generate.ts       orchestrates: gen.generateBatch → ruby/reading → tx insert items + generations
```

Client changes:

```
client/src/
  components/GenerateForm.tsx     mode: 'full' | 'compact', shared by Settings + Today empty state
  screens/SettingsScreen.tsx      promotes the existing Settings stub to a real screen
  api-hooks.ts                    + useGenerateItems(), + useGenerations(), + useSettingsStatus()
```

Routing adds one client route, `/settings`, reachable from a small `Settings` link in the Today header (next to the existing Sign-out — which we move into the Settings screen). No new bottom tab. Settings is a "occasionally" destination, not a primary surface.

## Data model

One new table, **`generations`**:

```sql
CREATE TABLE generations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  skill           text NOT NULL DEFAULT 'vocab',
  count_requested integer NOT NULL,
  count_inserted  integer NOT NULL DEFAULT 0,
  weakness_hint   text,
  model           text NOT NULL,
  prompt          jsonb NOT NULL,
  response        jsonb,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  cost_usd        numeric(10,6) NOT NULL DEFAULT 0,
  status          text NOT NULL CHECK (status IN ('success','partial','failed')),
  error           text
);
CREATE INDEX generations_requested_at_idx ON generations(requested_at DESC);
```

The `items` table needs **no schema change**. AI items use the existing columns:

- `source = 'ai'` (new value; column already exists).
- `external_id = 'ai-' || gen_random_uuid()` — each generated item is intentionally unique. No dedupe against seed (the model can give a fresher sentence for the same word; you can prune in Browse later).
- `prompt` jsonb: `{ target, sentence_ruby, sentence_english }`.
- `answer` jsonb: `{ meaning, reading }`.
- `tags = []` for v1.

## API

All endpoints sit behind the existing passcode middleware.

### `POST /api/generate`

```
Body:  { skill: 'vocab', count: 1..50, weakness_hint?: string }   // hint ≤ 200 chars
200:   {
         generation_id: uuid,
         status: 'success' | 'partial',
         items_created: integer,
         cost_usd: number,
         items: ItemRecord[]      // newly inserted, ready to surface in queue
       }
400:   invalid body (zod errors)
502:   {
         generation_id: uuid,
         status: 'failed',
         items_created: 0,
         cost_usd: number,        // tokens billed even on parse-failures
         error: string
       }
```

Server flow:

1. Validate body with zod.
2. `gen.generateBatch({ count, weakness_hint })` → `{ sentences, usage }`. Internally retries up to 3× on parse failure (existing behavior carried from the seed importer).
3. For each parsed entry: build the item via `gen.toRubyHtml(sentence_japanese)` and `gen.readingFor(target)`.
4. Single transaction: `INSERT INTO items` (one row per entry) + `INSERT INTO generations` with the final `status`, `count_inserted`, prompt, response, usage, and computed `cost_usd`.
5. Return `{ generation_id, status, items_created, cost_usd, items }`.

If `gen.generateBatch` exhausts retries or the SDK throws, skip the items insert, write a single `generations` row with `status='failed'`, and return 502 carrying the same `generation_id` so the Settings list still shows the failure.

### `GET /api/generations?limit=10&offset=0`

```
200:  {
        generations: [{
          id, requested_at, skill,
          count_requested, count_inserted, weakness_hint,
          cost_usd, status, error
        }]
      }
```

The `prompt` and `response` jsonb columns are deliberately **excluded from the API**. They live in the DB for SQL forensics on bad batches.

### `GET /api/settings/status`

```
200:  { ai_key_configured: boolean }
```

Simply checks whether `process.env.ANTHROPIC_API_KEY` is non-empty. No secrets leave the server.

## UX

### `<GenerateForm>` component

Two modes:

- **Full** (Settings): heading "Generate vocab", count input (1–50, default 10), weakness-hint textarea (placeholder `e.g., verbs for cooking`, ≤200 chars), submit button. Button label is dynamic: `Generate 10 vocab (~$0.01)`. Estimate is `count × $0.001` rounded up to the nearest cent — calibrated against the Phase 1 seed import (306 cards / $0.30).
- **Compact** (Today empty state): count input + button only. No hint field, no header.

Disabled + spinner while in flight. On success: toast `Added 10 cards · $0.01`. On `partial`: `Added 8 of 10 cards · $0.01`. On failure: `Generation failed — try again`. After any non-failed result, the queue query is invalidated so the new cards appear immediately.

### Settings screen (`/settings`)

Reached from a small `Settings` link in the Today header (replacing the current Sign-out which moves here). Sections, top-to-bottom:

1. **AI key** — single status pill: `✓ Configured (set via .env)` or `✗ Not configured`. Sourced from `GET /api/settings/status`. No edit affordance.
2. **Generate vocab** — `<GenerateForm mode="full" />`.
3. **Recent generations** — list rendered from `GET /api/generations?limit=10`. Each row: `May 6, 2:14p · 10 cards · $0.01 · ✓` or `… · ✗ failed`. Static rows in v1 (no expand-to-show-error; query the DB directly for forensics).
4. **Sign out** — moved here from the Today header.

### Today empty state

When `GET /api/queue` returns `{ due: [], new: [] }`, the screen shows:

```
✓ All caught up
0 cards ready

[count: 10]   [ Generate 10 vocab (~$0.01) ]
```

`<GenerateForm mode="compact" />` is embedded inline. After a successful generation, the queue query refetches and the new cards become reviewable without a navigation.

## Error handling & cost

**Claude failures.** `gen.generateBatch` retains its 3-attempt retry on parse errors. After exhaustion:

- Transport / SDK error: `generations` row with `status='failed'`, `response=null`, `error` = error message. Server returns 502.
- Whole-batch parse failure: same row, but `response` jsonb captures the raw text so post-mortem is possible in SQL.
- Partial parse: valid entries are inserted, `status='partial'`, `count_inserted < count_requested`.

**DB failures during item insert.** The items inserts and the success/partial `generations` row are wrapped in one transaction. If any item insert fails, the transaction rolls back; we then issue a separate, non-transactional insert of a `generations` row with `status='failed'` so the run is still logged. Net effect: every `/api/generate` request produces exactly one `generations` row — either the success/partial one written inside the committed tx, or the failed one written after rollback.

**Cost.** `cost_usd = input_tokens × $3/1M + output_tokens × $15/1M`, stored as `numeric(10,6)`. The `pricing.ts` module in `gen/` is the single source of truth — both seed and server import from it; a model-price change is one diff.

**Server-side timeout.** A 60-second timeout on `/api/generate` (~3 internal batches × ~10s each at the 50-card cap). On timeout we abort the upstream call, write `status='failed'`, return 502.

**Kuromoji singleton.** Lazy-load on the first request that needs it. ~1–2s cost on the first call after server boot; cached for the process lifetime.

**No rate limiting.** Single user, passcode auth, count ≤ 50, button disables during in-flight requests. Worst-case accidental cost from a double-click is one extra ~$0.05 generation.

## Testing

### `gen/` package

- `prompt.test.ts` — snapshot the user prompt for `count=2` with and without weakness hint; ensure the hint text appears in the prompt.
- `parse.test.ts` — JSON shape, malformed input, code-fence stripping (carried over from seed).
- `furigana.test.ts` — `toRubyHtml` and `readingFor` round-trips on a kanji term and a kana-only term.
- `pricing.test.ts` — `computeCost({input, output})` against known values.
- `generate.test.ts` — `generateBatch` with a mocked Anthropic client: happy path, retry-then-succeed, retry-exhausted (carried over from seed).

### Server

- `server/src/routes/generate.test.ts`
  - Happy path: mocked `gen.generateBatch` returns 2 valid entries → 2 rows in `items`, 1 row in `generations`, 200 with both items + `generation_id`.
  - Partial: gen returns 2 of 3 valid → 2 items inserted, `generations.status='partial'`, `count_inserted=2`.
  - Failed: gen throws → 0 items, `generations.status='failed'`, response 502 with the same `generation_id`.
  - Validation: zod rejects `count=0`, `count=51`, missing `skill`, hint > 200 chars → 400.
- `server/src/routes/generations.test.ts`
  - Returns rows in `requested_at DESC` order.
  - Honors `?limit=` and `?offset=`.
  - Response excludes `prompt` and `response` jsonb (assert explicitly).
- `server/src/routes/settings.test.ts`
  - Returns `{ ai_key_configured: true }` when env var set, `false` otherwise.

### E2E

Extend `e2e/tests/smoke.spec.ts` (or add `generate.spec.ts`) to cover the empty-state generation flow:

- Test mode: env var `NIHONGO_FAKE_AI=1` causes `gen.generateBatch` to return a deterministic fixture (3 canned vocab entries) instead of calling Claude. Set in `e2e/playwright.config.ts`.
- Fixture: a new `e2e/tests/fixtures/seed-test-empty.sql` resets `items`/`review_state`/`reviews` so Today renders the empty state at the start of the spec. The existing `seed-test-items.sql` continues to back the Phase 1 smoke spec.
- Scenario: passcode → Today empty state → fill compact form (count=3) → click Generate → toast appears → queue shows the 3 canned items → review the first one. Mirrors the existing smoke flow's deterministic style.

The fake-AI hook lives in `gen/src/generate.ts` — when `NIHONGO_FAKE_AI=1`, `generateBatch` short-circuits to a fixture without instantiating the SDK.

## Open questions / future work

- **Manual review gate** for AI items (Phase 2). Today they enter the queue immediately; a Browse-edit affordance + `status='pending_review'` is the natural Phase 2 add.
- **Auto weakness hints** derived from miss history. Free-form text covers the immediate need; promote later if you keep typing the same hints.
- **Settings list expand-row** to show prompt + response inline. Skipped in v1 to keep the screen calm; SQL is good enough for forensics.
- **AI key rotation UI**. Out of scope for Phase 1.5.
- **Eager kuromoji load** if first-request latency on the AI flow ever bothers you. Lazy is fine for now.
