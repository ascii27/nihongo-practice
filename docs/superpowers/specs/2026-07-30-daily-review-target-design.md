# Daily review target — design

**Date:** 2026-07-30
**Branch:** `feat/daily-review-target`

## Problem

The Today screen's "Ready to review" hero sums `due + new` across every skill
(`DashboardScreen.tsx:31`). After a bulk vocab import that number is in the
hundreds. It reads as a debt, not a goal, and it is also a lie: the practice
queue only ever serves 20 due + 10 new cards per session
(`services/queue.ts:4-5`), so the number on the dashboard has never matched the
session you actually get.

## Goal

Show a bounded daily target instead. When the target is met, congratulate and
stop. Let the owner opt into more work explicitly, and let them tune the target
from Settings.

## Decisions

| Question | Decision |
|---|---|
| Cap the session too, or display only? | Cap both — the target replaces the hardcoded queue caps |
| Default target / stepper | Default 30, steps of 10, clamped 10–100 |
| Per-skill rows | Keep raw pool counts — only the hero is capped |
| "Go another round" | Unlocks one more full target, repeatable |
| Do lesson reviews count? | Yes — any row written by `POST /api/reviews` counts |

Default 30 is deliberate: it equals today's effective cap (20 due + 10 new), so
nothing changes behaviorally until the dial is moved.

## Data model

One migration, `db/migrations/1783728000000_daily_target.sql`:

```sql
CREATE TABLE app_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  daily_review_target int NOT NULL DEFAULT 30
    CHECK (daily_review_target BETWEEN 10 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings (id) VALUES (true);

CREATE TABLE daily_rounds (
  day date PRIMARY KEY,
  extra_rounds int NOT NULL DEFAULT 0
);
```

`app_settings` uses the single-row singleton pattern — the `CHECK (id)` on a
boolean primary key makes a second row impossible. This app is single-user; if
that ever changes, the table gains a `user_id` and drops the constraint.

`daily_rounds` is day-scoped state, not a preference, so it lives apart from
settings. Rows accumulate one per day the owner asked for extra work; that is a
few hundred rows a decade, so no cleanup job.

## Server

### `services/daily-budget.ts` (new)

The single source of truth. Both the dashboard and the queue call it, so they
cannot disagree.

```ts
type DailyBudget = {
  target: number;        // configured setting
  extra_rounds: number;  // rounds unlocked today
  allowance: number;     // target × (1 + extra_rounds)
  reviewed: number;      // reviews logged today, in tz
  remaining: number;     // max(0, allowance − reviewed)
};

getDailyBudget(tz: string): Promise<DailyBudget>
unlockRound(tz: string): Promise<DailyBudget>   // upsert daily_rounds +1
```

`reviewed` counts rows in `reviews` bucketed by `date_trunc('day', reviewed_at
AT TIME ZONE $tz)`, matching how `services/streak.ts` and `routes/stats.ts`
already bucket days. Every review counts, whatever produced it — mixed
practice and lesson blocks both post to `POST /api/reviews`. Cram
(`study-lists`) does not log reviews, so cramming stays free and never eats the
allowance.

### `GET /api/dashboard`

- Accepts `?tz=` (validated with the same `resolveTz` guard `routes/queue.ts:8`
  uses). Defaults to `UTC`, which is today's hardcoded behavior.
- Response gains `daily_target`, `reviewed_today`, `remaining`. `by_skill` and
  `streak_days` are unchanged.

### `POST /api/dashboard/round`

Increments `extra_rounds` for today and returns the same payload shape as
`GET /api/dashboard`, so the client can swap state without a second fetch.

### `services/queue.ts`

`DAILY_NEW_CAP` and `DUE_CAP` are deleted. Sizing derives from the budget:

```
sessionCap = min(req.limit, budget.remaining)
newShare   = round(target / 3) × (1 + extra_rounds) − introducedToday
newLimit   = clamp(newShare, 0, sessionCap)
-- fetch new first, then:
dueLimit   = sessionCap − new.length
```

At target 30 this yields 10 new + 20 due — exactly today's behavior. Two
intentional changes fall out of it:

1. The new-card budget becomes **global** rather than per-skill. One daily
   target means one budget; scoping it per skill would let eight skills each
   introduce a full share.
2. When no new cards remain, due now fills the whole `sessionCap` instead of
   stopping at 20.

When `remaining` is 0 the queue returns `{ due: [], new: [] }`. The client
already renders an empty queue as "nothing to practice".

### `GET /api/settings/status` and `PATCH /api/settings`

`status` gains `daily_review_target`. `PATCH` accepts `{ daily_review_target }`,
validated by a zod schema in `shared` — integer, multiple of 10, 10–100 — and
returns the persisted value. Out-of-range or non-multiple values are a 400 with
the existing error shape.

## Client

### `DashboardScreen.tsx`

The hero has three states, chosen in this order:

| Condition | Hero |
|---|---|
| `remaining > 0 && pool > 0` | count = `min(remaining, pool)`, "Start mixed practice" — current layout, smaller number |
| `remaining === 0` | 今日の分、終わり — done for today · "{reviewed_today} reviewed" · **Go another round** |
| `pool === 0` | existing 全部終わり — all caught up. No round button: there is nothing left to serve |

`pool` is the existing `totalDue` sum. Ordering matters — a met target shows
the congratulation even when a backlog exists, which is the whole point, but an
empty pool must not offer a round that would come back empty.

"Go another round" posts to `/api/dashboard/round` and replaces state from the
response. Skill rows keep their raw `due · new` counts in every state: the hero
is the motivational number, the rows are the honest inventory.

The dashboard fetch passes `tz` from `Intl.DateTimeFormat().resolvedOptions().timeZone`.

### `SettingsScreen.tsx`

A new "Practice" section above "Add a word":

```
Daily review target        [ − ]  30  [ + ]
Cards per day before you're done.
```

`−`/`+` step by 10 and clamp to 10–100, disabling at the ends. Each press
PATCHes and reflects the persisted value. Failure reverts the displayed number
and shows an inline error, consistent with the other settings rows.

## Shared types

`DashboardResponse` gains the three fields; `SettingsStatusResponse` gains
`daily_review_target`; a new `UpdateSettingsRequest` covers the PATCH body. All
three are zod schemas in `shared/src/types.ts`, matching existing convention.
`shared/src/types.test.ts` already asserts `DashboardResponse` rejects payloads
missing a bucket — the new required fields extend that test.

## Testing

TDD throughout, mirroring existing suites:

- `services/daily-budget.test.ts` — allowance with 0/1/2 extra rounds, tz-bucket
  boundaries (a review just before local midnight counts for the right day),
  `remaining` flooring at 0 when reviewed exceeds allowance
- `routes/dashboard.test.ts` — the three hero-driving field combinations; the
  round endpoint increments and returns a fresh payload; `tz` is honored and an
  invalid tz falls back to UTC
- `routes/queue.test.ts` — session sized by target not the old constants; empty
  queue at `remaining = 0`; due fills the cap when no new cards exist; new-card
  budget is global across skills
- `routes/settings.test.ts` — PATCH persists; 400 on 5, 105, 25, and non-integer

## Out of scope

Per-skill targets, a weekly goal, catch-up carryover from missed days, and any
notification or reminder. The owner can raise the target or take another round;
that is enough control for now.
