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
already bucket days. Mixed practice and lesson blocks both post to
`POST /api/reviews` and both count.

Two kinds of practice post to `POST /api/reviews` too — cram (`study-lists`) and
free practice (tapping a skill row) — and both grade and reschedule exactly like
ordinary practice. But they send `free_practice: true`, and `reviewed` excludes
those rows. Both are work the owner chose on top of the day's plan, not a draw
against it; counting them would let one 40-card cram zero out `remaining` and
leave every practice entry point empty until midnight. The flag is explicit
rather than inferred from `session_id IS NULL`, which is a property of today's
client rather than a contract.

`countIntroducedToday` (the new-card pacing limit, below) deliberately goes the
other way and **does** count those rows: a brand-new card drilled or crammed
gets a `review_state` row and leaves the new pool for good, so it has genuinely
been introduced. The allowance caps how much the day asks of the owner; the
introduction count caps how many new cards enter the SRS. Free practice is extra
against the first and real against the second.

### `GET /api/dashboard`

- Accepts `?tz=` (validated with the same `resolveTz` guard `routes/queue.ts:8`
  uses). Defaults to `UTC`, which is today's hardcoded behavior.
- Response gains `daily_target`, `reviewed_today`, `remaining`, `session_size`
  and `another_round_size`. `streak_days` is unchanged; `by_skill` now excludes
  suspended items from its due counts, matching `services/queue.ts`.

`session_size` is the number the hero shows: exactly what the next mixed
practice session will deal. `remaining` is **not** that number, and neither is
`min(remaining, pool)` — the new-card share caps how much of a new-only deck a
session can touch, so a 300-new deck at a target of 30 yields 10 cards, not 30.
The server resolves the plan against the real pools (via `sessionSize`, using
the queue route's default limit, since mixed practice sends neither `skill` nor
`limit`) so the client never re-derives a number of its own.

`another_round_size` is the same figure computed against `previewRound(budget)`
— the budget as it would stand after unlocking one more round, without writing
anything. A round raises the allowance and the new-card share together, so it
can rescue a session that is empty for either reason, but it cannot conjure
cards: 0 means offering a round would be a dead end.

### `POST /api/dashboard/round`

Increments `extra_rounds` for today and returns the same payload shape as
`GET /api/dashboard`, so the client can swap state without a second fetch.

### `services/session-plan.ts` (new) and `services/queue.ts`

`DAILY_NEW_CAP` and `DUE_CAP` are deleted. Sizing derives from the budget, and
lives in `services/session-plan.ts` as two pure functions — `planSession` and
`sessionSize` — because both the queue and the dashboard need it and they must
not drift. `sessionSize` models `buildQueue`'s ordering rather than an
idealized version: new cards are taken first and due gets only what is left of
the cap after the new rows that really existed, which is what makes the thin-pool
cases come out right.

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

The hero has four states, chosen in this order:

| Condition | Hero |
|---|---|
| `pool === 0` | 全部終わり — all caught up. Count 0, no buttons: there is nothing left to serve |
| `remaining === 0` | 今日の分、終わり — done for today · "{reviewed_today} reviewed" · **Go another round** when `another_round_size > 0` |
| `session_size === 0` | count 0 · "Today's new cards are done and nothing else is due" · **Go another round** when `another_round_size > 0` |
| otherwise | count = `session_size`, "Start mixed practice" |

**Invariant (hero only): the number on the hero equals the number of cards the
next mixed practice session will actually deal, and no hero state offers
practice it cannot deliver.** That is why the count is always `session_size` and
never a client-side derivation, and why both round buttons are gated on
`another_round_size > 0` — tapping a round that deals nothing is the same
broken promise in a slower form.

The invariant is scoped to the hero because the skill rows below it no longer
answer to the budget at all: a row deals **free practice** (below), so it always
has cards to give whenever the skill has any. This was finding **I2 from the
final whole-branch review** — tapping a row once the target was met dead-ended
on "Nothing due here." — and it is now closed, by making skill practice free
rather than by disabling the rows.

`pool` is the `by_skill` sum, used only for the "still in the deck" copy and to
tell an empty deck from a spent budget. Ordering matters. An empty deck reads as
全部終わり before anything else. A met target then takes precedence over a
backlog, which is the whole point of the target. Only after both comes the third
state, which is reachable in exactly one shape: budget left and cards left, but
the day's new-card share spent and nothing due — so the deck is all new cards
the pacing limit will not release yet. It gets its own copy rather than
borrowing 今日の分、終わり, which belongs to a met target.

"Go another round" posts to `/api/dashboard/round` and replaces state from the
response. Skill rows keep their raw `due · new` counts in every state: the hero
is the motivational number, the rows are the honest inventory of what free
practice can draw on.

### Free practice

Tapping a skill row is free practice, always — not only once the target is met.
The daily target governs the day's plan; it was never meant to govern whether
deliberate practice is allowed. So a row deals a fixed **20-card** session
(`FREE_PRACTICE_SIZE`) that ignores the allowance and the new-card pacing limit
alike, and the reviews it produces are flagged `free_practice` and kept out of
`reviewed_today`. Drill a skill as many times as you like; the day's number does
not move.

Free practice leads with **due** cards and tops up with new, the opposite of the
budgeted queue. Someone who asked for a skill wants the cards they owe on it.
The budgeted queue leads with new because its new-card share is metered and
would otherwise go unspent behind a deep due backlog; free practice has no share
to protect.

Two consequences worth stating rather than discovering. Free practice *can*
introduce new cards past the day's pacing limit — that is the point of "free" —
but what it introduces still counts toward `countIntroducedToday`, so heavy
drilling shrinks the budgeted queue's new-card share for the rest of the day.
And introducing cards schedules them, so free practice grows tomorrow's due
backlog exactly as ordinary practice does.

The client routes it by presence of a skill: `onPractice(undefined)` from the
hero is budgeted mixed practice, `onPractice(skill)` from a row is free.

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
