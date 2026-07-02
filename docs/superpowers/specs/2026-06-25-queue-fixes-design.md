# Queue fixes: new-item starvation, repetition, and leeches

**Date:** 2026-06-25
**Status:** Approved (design)

## Problem

Users doing short, infrequent practice sessions report seeing "the same group"
of items every time, across multi-day gaps, and never reaching new material.

Investigation of production data (410 items) confirmed:

- Only 58 items have ever been reviewed; **352 items have never been served**.
- 54 of the 58 reviewed items are overdue — a backlog that never drains.
- The spaced-repetition math is **correct and persisting**: items graduate
  through boxes (37 in box 3, 6 in box 4), and each answer is saved per-card
  the instant it is submitted (`reviews.ts`), independent of finishing a session.

The fault is entirely in queue *selection policy* (`server/src/services/queue.ts`):

1. **New-item starvation.** New items are only served when fewer than 10 items
   are due (`due.length < NEW_THRESHOLD`). With a permanent overdue backlog of
   54, that gate never opens, so no new items are ever introduced.
2. **Deterministic ordering.** Due items are served strictly most-overdue-first
   (`ORDER BY next_review_at ASC`). A ~3-card session always replays the same
   opening cards.
3. **Leeches clog the front.** Repeatedly-missed items reset to box 1 / +1 day,
   so they are perpetually overdue and sit near the front. One current item was
   missed 4/4 times.

## Goals

- Always introduce new material on a daily cadence regardless of due backlog.
- Vary which due cards appear first so short sessions don't replay the same set.
- Set aside chronic leeches so they stop dominating the queue.

Non-goals: changing Leitner intervals, the per-review persistence path, or
session start/end. No manual leech-revive UI (future work).

## Decisions (confirmed with owner)

| Parameter            | Value                                   |
|----------------------|-----------------------------------------|
| New items per day    | **10**, counted per calendar day in user's timezone |
| Due ordering         | **Shuffle** the due set (`ORDER BY random()`) |
| Due cap per session  | **20**                                  |
| Leech suspension     | After **8 total misses**                |

## Design

### Change 1 — Daily new-item guarantee

New items are served on every session, decoupled from the due backlog, capped
at 10 per calendar day in the caller's timezone (so several short sessions in
one day share the budget).

- A brand-new item's first review always records `box_before = 0`
  (`reviews.ts` passes `prev?.box ?? 0`). Therefore **new items introduced
  today** =
  `COUNT(reviews WHERE box_before = 0 AND date_trunc('day', reviewed_at AT TIME ZONE $tz) = today)`.
  This reuses the timezone bucketing pattern already used in `streak.ts`.
- Serve `max(0, 10 - introducedToday)` new items, ordered by `created_at ASC`
  (stable progression through the imported deck), excluding suspended items.
- The new-item query no longer gates on `due.length`.

### Change 2 — Shuffle + cap the due set

Due selection becomes:

```sql
SELECT ... FROM items i
  JOIN review_state rs ON rs.item_id = i.id
 WHERE ($1::text IS NULL OR i.skill = $1)
   AND rs.next_review_at <= now()
   AND rs.suspended = false
 ORDER BY random()
 LIMIT 20
```

A random 20 from the whole due pool each session: opening cards vary, and over
repeated sessions the entire backlog is covered. Most-overdue is no longer
forced to the front (faithful to the "shuffle the due set" choice).

### Change 3 — Leech suspension

- **Migration** adds `review_state.suspended boolean NOT NULL DEFAULT false`.
- In `reviews.ts`, after computing the next state, set `suspended = true` when
  `total_missed >= 8`. (Implemented in the upsert; once true it stays true.)
- Both the due and new queries exclude `suspended = true`.

### API / client

- `GET /api/queue` gains an optional `tz` query param (IANA name), defaulting to
  `UTC`, used only for the daily new-item count. Invalid/missing → `UTC`.
- The client (`api-hooks.ts` `fetchQueue`) passes
  `Intl.DateTimeFormat().resolvedOptions().timeZone`, mirroring the existing
  streak/stats calls.

### Function signature

`buildQueue` gains the timezone and uses fixed internal constants for the daily
new cap (10) and due cap (20):

```ts
buildQueue(opts: { limit: number; skill?: string; tz: string })
  : Promise<{ due: ItemRecord[]; new: ItemRecord[] }>
```

The existing `limit` query param is retained for compatibility but the due cap
is the binding limit (`min(limit, 20)`).

## Testing

- `leitner.ts` unit tests: unchanged (intervals untouched).
- `queue.test.ts` (new cases, using existing DB fixture setup):
  - New-item budget = 10 minus items first-seen today; respects the budget
    across multiple sessions in the same day.
  - New items served even when due backlog ≥ 10.
  - Suspended items excluded from both due and new.
  - Due result capped at 20 and drawn from the due pool.
  - `tz` boundary: an item introduced "today" in one tz vs "yesterday" in
    another counts correctly.
- `reviews.test.ts`: reaching 8 total misses sets `suspended = true`; fewer
  than 8 leaves it false.

## Files touched

- `db/migrations/1782950400000_review_state_suspended.sql` (new; timestamp after the latest existing migration)
- `server/src/services/queue.ts`
- `server/src/routes/queue.ts`
- `server/src/routes/reviews.ts`
- `client/src/api-hooks.ts` (one line)
- Tests: `server/src/services/queue.test.ts`, `server/src/routes/reviews.test.ts`
