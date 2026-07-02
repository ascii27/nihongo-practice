# Design: nihongo-practice → Hermes progress events

**Status:** Design approved-in-progress. Brainstorming paused before final approval +
spec self-review. Resume by confirming the open items in §9, then proceed to
writing-plans.

**Goal:** Send Japanese-study progress data from `nihongo-practice` to the user's
Hermes instance (`hermes-jester`) so the user's Hermes agent **Eva** can track
progress. Inspired by the Cadence → Hermes integration
(https://github.com/ascii27/cadence-fitness/blob/main/docs/eva-hermes-prompt.md).

**Hermes instance:** `https://lectern-queenside.exe.xyz`
(repo: https://github.com/ascii27/hermes-jester)

---

## Decisions locked in (from brainstorming)

1. **What to send:** Per-review events + milestone events (the richest, most
   flexible option — Eva gets the raw stream and can compute anything).
2. **Delivery:** Fire-and-forget async. The review POST never blocks on Hermes;
   failures are logged, not retried. (No durable outbox — chose simplicity.)
3. **Type model:** A single Hermes type `nihongo_event` carrying an envelope
   `{ event_type, occurred_at, data }`, matching the Cadence/Eva convention so
   Eva reads both apps the same way.

---

## Relevant Hermes API (verbatim essentials)

- Auth: `Authorization: Bearer <api_key>`. Scopes: `write` (submit), `read`
  (poll/ack), `admin` (manage types & keys).
- Create type: `POST /api/types` with `{ name, description, schema }` (schema is
  JSON Schema). Requires **admin** scope.
- Submit item: `POST /api/item/{type}` — the request body **is** the payload,
  validated against the type's JSON Schema. Returns 422 if validation fails.
  Requires **write** scope.

## Cadence pattern (the inspiration)

One Jester type `cadence_event`; every event is the envelope
`{ "event_type": "...", "occurred_at": "<UTC ISO-8601>", "data": { ... } }`.
Sub-events: `workout_logged`, `milestone`, `routine_reverted`. Delivery is
at-least-once / unordered → consumer dedups by a natural key inside `data`.

---

## 1. Hermes type: `nihongo_event`

Permissive envelope schema (sub-event detail lives inside `data`, like Cadence):

```json
{
  "type": "object",
  "required": ["event_type", "occurred_at", "data"],
  "additionalProperties": false,
  "properties": {
    "event_type": { "type": "string", "enum": ["review_logged", "milestone"] },
    "occurred_at": { "type": "string", "format": "date-time" },
    "data": { "type": "object" }
  }
}
```

## 2. Event payloads

**`review_logged`** — emitted once per *fresh* card grade. Natural key for Eva
dedup = `item_id` + `reviewed_at`.

```
{
  item_id, skill, result ("got_it" | "missed"), reviewed_at (ISO),
  box_before, box_after, total_reviews, total_missed, suspended (bool),
  session_id (nullable), front, meaning
}
```

`front` / `meaning` come from `itemDisplay(skill, prompt, answer)` (see
`server/src/services/item-display.ts`) so Eva can name the card. Requires a small
extra `SELECT i.skill, i.prompt, i.answer` — acceptable since it runs off the hot
path (fire-and-forget after commit).

**`milestone`** — streak thresholds. Natural key = `streak_days` + `session_date`.

```
{ milestone_type: "streak", streak_days (7|14|30), session_date (YYYY-MM-DD), item_id }
```

## 3. Hook point

`server/src/routes/reviews.ts`, **only on the fresh-insert path**. The
idempotent-duplicate early return (existing review at same `item_id`+`reviewed_at`)
emits nothing. After `client.query("COMMIT")` and `res.json(...)`, fire-and-forget:

- `emitReviewLogged(...)` — always.
- Milestone: add optional `tz` to the review request body (client already computes
  `Intl.DateTimeFormat().resolvedOptions().timeZone` — see
  `client/src/api-hooks.ts`). After commit, if this is the *first review of "today"*
  in `tz` AND the new streak equals 7/14/30, `emitMilestone(...)`.

Streak detection lives in a pure helper `detectStreakMilestone(tz, reviewedAt)`
(in `server/src/services/streak.ts` or a new `hermes` helper) returning the
crossed threshold or `null`, so it is unit-testable without HTTP. It reuses
`computeStreak(tz)` from `server/src/services/streak.ts`.

"First review of today" = count of reviews whose `reviewed_at AT TIME ZONE tz`
falls on today's date == 1 (just-inserted one). This prevents re-emitting the
milestone on later same-day reviews.

## 4. New module: `server/src/services/hermes.ts`

- `postEvent(eventType, occurredAt, data)` — builds the envelope and does
  `POST ${HERMES_BASE_URL}/api/item/nihongo_event` with
  `Authorization: Bearer ${HERMES_WRITE_KEY}`, `Content-Type: application/json`.
  Catches + logs all errors; never throws into the caller.
- **No-op when unconfigured** (missing `HERMES_WRITE_KEY` or `HERMES_BASE_URL`) —
  keeps dev / test / CI clean and makes the integration opt-in.
- Convenience wrappers `emitReviewLogged(...)`, `emitMilestone(...)`.
- Called un-awaited with `.catch(log)` from the route (fire-and-forget).

## 5. Config (`server/src/env.ts`, `.env.example`)

Two **optional** vars (optional so the app still boots without them):

```
HERMES_BASE_URL=https://lectern-queenside.exe.xyz
HERMES_WRITE_KEY=<write-scoped key — user provides>
```

`HERMES_WRITE_KEY` must be kept out of git (already covered by `.gitignore` for
`.env`). `.env.example` documents both with placeholders.

## 6. Type registration

One-shot script `scripts/register-hermes-type.ts` + npm script `hermes:register`.
`POST /api/types` with the §1 schema, idempotent (handle "already exists" / non-201
gracefully). Type creation needs **admin** scope, so the script reads a separate
`HERMES_ADMIN_KEY` env var used *only* by the script — never the runtime write key.

Alternative (if preferred): skip the script and register via a one-line `curl`.
Decide in §9.

## 7. Testing (TDD)

- `hermes.test.ts` — envelope shape is correct; `postEvent` is a no-op when
  unconfigured (mock `fetch`); errors are swallowed.
- `detectStreakMilestone` unit tests — first-review-of-day gating + threshold
  edges (6→7, 7 again same day = no re-emit, 14, 30, non-threshold = null).
- `reviews.test.ts` — emit invoked on fresh insert, NOT on idempotent duplicate;
  existing review response/behavior unchanged (hermes module mocked).

## 8. Out of scope (YAGNI for now)

- Durable outbox / retry (chose fire-and-forget).
- Events for new-card additions, generations, suspensions (only per-review +
  streak milestones).
- Eva-side consumer logic (lives in the hermes-jester / Eva project).

## 9. Open items to confirm on resume

1. **Write key** value (`HERMES_WRITE_KEY`) — user to provide.
2. **Registration method**: registration script with `HERMES_ADMIN_KEY`, or a
   manual `curl` the user runs once? (admin scope required either way.)
3. Confirm **streak thresholds 7/14/30** match what Eva expects.

Once these are settled: run the brainstorming spec self-review, get final user
sign-off on this doc, then invoke the writing-plans skill to produce the
implementation plan.
