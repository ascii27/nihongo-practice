# Daily Review Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Today screen's uncapped backlog number with a bounded daily review target that the owner can tune in Settings and extend on demand with a "Go another round" button.

**Architecture:** A new `services/daily-budget.ts` is the single source of truth for how many cards remain today (`target × (1 + extra_rounds) − reviewed_today`, bucketed in the caller's timezone). Both `GET /api/dashboard` and `services/queue.ts` read from it, so the number on the hero and the size of the session it starts can never disagree. The target lives in a new single-row `app_settings` table; extra rounds live in a day-keyed `daily_rounds` table.

**Tech Stack:** TypeScript, Express 4, Postgres (`pg` + `node-pg-migrate` with raw `.sql` migrations), zod schemas in the `@nihongo/shared` workspace, React 18 + Vite client, Vitest for server/shared tests, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-07-30-daily-review-target-design.md`

## Global Constraints

- Default daily review target is **30**. The stepper moves in **increments of 10**, clamped to **10–100** inclusive.
- Default 30 must reproduce today's exact queue behavior (10 new + 20 due) so nothing changes until the owner moves the dial.
- Mixed practice and lesson blocks both `POST /api/reviews` and both count toward the target. Cram logs reviews through the same endpoint but flags them `cram: true`; those rows stay outside the budget (they still count toward the new-card introduction limit — see the spec).
- Day bucketing always uses `date_trunc('day', <ts> AT TIME ZONE $tz)`, matching `services/streak.ts` and `routes/stats.ts`. Never bucket in UTC when a `tz` is available.
- Per-skill rows on the dashboard keep showing raw pool counts. Only the hero is capped.
- The `@nihongo/shared` workspace exports TypeScript source directly (`"main": "./src/types.ts"`), so no build step is needed between editing shared types and running server tests.
- Server tests run with `npm --workspace server test` and need Postgres up (`npm run db:up`) and migrated (`npm run db:migrate`).
- Commit after every task. Follow the repo's conventional-commit style (`feat(scope):`, `fix(scope):`, `docs(scope):`).

---

## File Structure

**Create:**
- `db/migrations/1783728000000_daily_target.sql` — `app_settings` + `daily_rounds` tables
- `server/src/services/tz.ts` — shared `resolveTz` helper (extracted from `routes/queue.ts`)
- `server/src/services/daily-budget.ts` — allowance math, the single source of truth
- `server/src/services/daily-budget.test.ts` — unit tests for the above

**Modify:**
- `shared/src/types.ts` — `DashboardResponse` +3 fields, `SettingsStatusResponse` +1 field, new `UpdateSettingsRequest`
- `shared/src/types.test.ts` — cover the new required fields
- `server/src/db/reset.ts` — truncate `daily_rounds`, restore the `app_settings` default
- `server/src/routes/queue.ts` — import `resolveTz` instead of defining it
- `server/src/services/queue.ts` — size sessions from the budget, delete `DUE_CAP` / `DAILY_NEW_CAP`
- `server/src/routes/queue.test.ts` — cover target-derived sizing
- `server/src/routes/settings.ts` — `daily_review_target` in `/status`, new `PATCH /`
- `server/src/routes/settings.test.ts` — cover the new field and PATCH validation
- `server/src/routes/dashboard.ts` — `?tz=`, budget fields, new `POST /round`
- `server/src/routes/dashboard.test.ts` — cover all of the above
- `client/src/api-hooks.ts` — `fetchDashboard` sends tz; new `unlockAnotherRound`, `updateDailyTarget`
- `client/src/screens/SettingsScreen.tsx` — new "Practice" section with the stepper
- `client/src/screens/DashboardScreen.tsx` — three hero states
- `client/src/styles/screens.css` — stepper + congratulation styles
- `e2e/tests/smoke.spec.ts` — one new test for the congratulation state

---

## Task 1: Schema and shared types

Lays down the tables and the API contracts everything else consumes. No behavior change yet — after this task the app still works exactly as before.

**Files:**
- Create: `db/migrations/1783728000000_daily_target.sql`
- Modify: `server/src/db/reset.ts`
- Modify: `shared/src/types.ts:146-149` (SettingsStatusResponse), `shared/src/types.ts:331-345` (DashboardResponse)
- Test: `shared/src/types.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - Tables `app_settings (id boolean, daily_review_target int, updated_at timestamptz)` and `daily_rounds (day date, extra_rounds int)`
  - `DashboardResponse` with added `daily_target: number`, `reviewed_today: number`, `remaining: number`
  - `SettingsStatusResponse` with added `daily_review_target: number`
  - `UpdateSettingsRequest = { daily_review_target: number }` — integer, multiple of 10, 10–100

- [ ] **Step 1: Write the migration**

Create `db/migrations/1783728000000_daily_target.sql`:

```sql
-- 1783728000000_daily_target.sql
-- A bounded daily review goal. `app_settings` is a single-row singleton: the
-- boolean primary key with CHECK (id) makes a second row impossible, which is
-- the right shape for a single-user app. `daily_rounds` is day-scoped state
-- rather than a preference — one row per day the owner asked for extra work —
-- so it lives apart from the settings row.

CREATE TABLE app_settings (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  daily_review_target int NOT NULL DEFAULT 30
    CHECK (daily_review_target BETWEEN 10 AND 100),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (id) VALUES (true);

CREATE TABLE daily_rounds (
  day          date PRIMARY KEY,
  extra_rounds int NOT NULL DEFAULT 0
);
```

- [ ] **Step 2: Run the migration and verify it applies**

```bash
npm run db:up
npm run db:migrate
```

Expected: log line for `1783728000000_daily_target`, exit 0. Verify the seeded row exists:

```bash
docker compose exec -T postgres psql -U nihongo -d nihongo -c "SELECT * FROM app_settings;"
```

Expected: exactly one row, `daily_review_target = 30`.

If the `psql` connection details differ, read them from `docker-compose.yml` — do not guess.

- [ ] **Step 3: Update the test reset helper**

`app_settings` holds a seeded singleton, so it must NOT be truncated — truncating it would delete the row every test and leave `getDailyBudget` reading from an empty table. Reset it to the default value instead. `daily_rounds` is ordinary state and gets truncated.

In `server/src/db/reset.ts`, replace the body of `resetDb`:

```ts
import { pool } from "./pool.js";

// Truncates application tables in FK order. Use in test beforeEach.
// pgmigrations and grammar_points (seeded reference data) are left alone so the
// schema stays migrated and the grammar catalog stays available to tests.
// app_settings is a seeded singleton — reset its values rather than truncating,
// or every test would run against a table with no settings row.
export async function resetDb(): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE reviews, review_state, items, sessions, generations, lessons, kanji, study_lists, daily_rounds
    RESTART IDENTITY CASCADE
  `);
  await pool.query(`UPDATE app_settings SET daily_review_target = 30, updated_at = now()`);
}
```

- [ ] **Step 4: Write the failing shared-type tests**

Append to `shared/src/types.test.ts` (import `UpdateSettingsRequest` and `SettingsStatusResponse` by adding them to the existing import list on line 2):

```ts
describe("daily review target types", () => {
  const fullBySkill = {
    vocab: { due: 0, new: 0 }, grammar: { due: 0, new: 0 }, reading: { due: 0, new: 0 },
    conjugation: { due: 0, new: 0 }, particle: { due: 0, new: 0 }, explain: { due: 0, new: 0 },
    listening: { due: 0, new: 0 }, kanji: { due: 0, new: 0 },
  };

  it("DashboardResponse requires the budget fields", () => {
    const without = { streak_days: 0, last_practiced_at: null, by_skill: fullBySkill };
    expect(DashboardResponse.safeParse(without).success).toBe(false);

    const with_ = { ...without, daily_target: 30, reviewed_today: 4, remaining: 26 };
    expect(DashboardResponse.safeParse(with_).success).toBe(true);
  });

  it("SettingsStatusResponse carries the daily target", () => {
    expect(SettingsStatusResponse.safeParse({ ai_key_configured: true }).success).toBe(false);
    expect(SettingsStatusResponse.safeParse({ ai_key_configured: true, daily_review_target: 30 }).success).toBe(true);
  });

  it("UpdateSettingsRequest accepts multiples of 10 from 10 to 100", () => {
    for (const n of [10, 30, 100]) {
      expect(UpdateSettingsRequest.safeParse({ daily_review_target: n }).success).toBe(true);
    }
  });

  it("UpdateSettingsRequest rejects out-of-range and non-multiples", () => {
    for (const n of [0, 5, 25, 105, 30.5]) {
      expect(UpdateSettingsRequest.safeParse({ daily_review_target: n }).success).toBe(false);
    }
  });
});
```

If `by_skill` in `shared/src/types.ts` does not currently include a `kanji` bucket, drop `kanji` from `fullBySkill` above to match the real schema — read the schema at `shared/src/types.ts:331` before writing the test.

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm --workspace shared test`
Expected: FAIL — `UpdateSettingsRequest` is not exported, and the `DashboardResponse` / `SettingsStatusResponse` "with fields" assertions fail because the schemas do not declare them yet.

- [ ] **Step 6: Add the shared types**

In `shared/src/types.ts`, replace the `SettingsStatusResponse` block (currently lines 146-149):

```ts
export const SettingsStatusResponse = z.object({
  ai_key_configured: z.boolean(),
  daily_review_target: z.number().int(),
});
export type SettingsStatusResponse = z.infer<typeof SettingsStatusResponse>;

// The daily review goal. Multiples of 10 only — the Settings stepper moves in
// tens, and allowing arbitrary values would let a hand-crafted request produce
// a number the UI can never step back to.
export const UpdateSettingsRequest = z.object({
  daily_review_target: z.number().int().min(10).max(100).multipleOf(10),
});
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequest>;
```

Then extend `DashboardResponse` (currently ending around line 345) with three fields alongside `streak_days`:

```ts
export const DashboardResponse = z.object({
  streak_days: z.number().int().nonnegative(),
  last_practiced_at: z.string().nullable(),
  // Daily budget. `remaining` is what the hero shows (clamped against the
  // actual card pool client-side); `daily_target` and `reviewed_today` drive
  // the congratulation copy.
  daily_target: z.number().int().positive(),
  reviewed_today: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  by_skill: z.object({
    // ...unchanged, leave every existing bucket exactly as it is
  }),
});
```

Do not touch the existing `by_skill` object — only add the three fields above it.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm --workspace shared test`
Expected: PASS, including the pre-existing `DashboardResponse` bucket test.

- [ ] **Step 8: Commit**

```bash
git add db/migrations/1783728000000_daily_target.sql server/src/db/reset.ts shared/src/types.ts shared/src/types.test.ts
git commit -m "feat(daily-target): app_settings + daily_rounds schema and shared types"
```

---

## Task 2: The daily budget service

The allowance math, isolated and unit-tested, before anything consumes it.

**Files:**
- Create: `server/src/services/tz.ts`
- Create: `server/src/services/daily-budget.ts`
- Create: `server/src/services/daily-budget.test.ts`
- Modify: `server/src/routes/queue.ts:8-17` (delete the local `resolveTz`, import the shared one)

**Interfaces:**
- Consumes: `app_settings` / `daily_rounds` tables and `resetDb` from Task 1
- Produces:
  - `resolveTz(raw: unknown): string` from `../services/tz.js`
  - `type DailyBudget = { target: number; extra_rounds: number; allowance: number; reviewed: number; remaining: number }`
  - `getDailyBudget(tz: string): Promise<DailyBudget>`
  - `unlockRound(tz: string): Promise<DailyBudget>`
  - `countIntroducedToday(tz: string): Promise<number>`
  - `DEFAULT_TARGET = 30`

- [ ] **Step 1: Extract the tz helper**

Create `server/src/services/tz.ts`:

```ts
// Falls back to UTC on a missing or invalid zone rather than erroring. Routes
// that require an explicit tz (see routes/stats.ts) validate separately and
// return 400 — this helper is for endpoints where UTC is an acceptable default.
export function resolveTz(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "UTC";
  try {
    // Throws RangeError on an invalid IANA zone name.
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return "UTC";
  }
}
```

In `server/src/routes/queue.ts`, delete the local `resolveTz` function (lines 8-17) and add to the imports at the top:

```ts
import { resolveTz } from "../services/tz.js";
```

Leave the call site on line 30 unchanged.

- [ ] **Step 2: Write the failing budget tests**

Create `server/src/services/daily-budget.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { resetDb } from "../db/reset.js";
import { getDailyBudget, unlockRound, countIntroducedToday } from "./daily-budget.js";

// Reviews need a real item to point at.
async function insertItem(skill = "vocab"): Promise<string> {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ($1, '{}'::jsonb, '{}'::jsonb, 'seed', $2) RETURNING id`,
    [skill, `e-${Math.random()}`],
  );
  return r.rows[0].id;
}

// `hoursAgo` is relative to now, so tests stay independent of the wall clock.
async function insertReview(itemId: string, opts: { hoursAgo?: number; boxBefore?: number } = {}) {
  await pool.query(
    `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
     VALUES ($1, now() - make_interval(hours => $2::int), 'got_it', $3::int, $3::int + 1)`,
    [itemId, opts.hoursAgo ?? 0, opts.boxBefore ?? 1],
  );
}

beforeEach(() => resetDb());

describe("getDailyBudget", () => {
  it("returns the default target and a full allowance with no reviews", async () => {
    const b = await getDailyBudget("UTC");
    expect(b).toEqual({ target: 30, extra_rounds: 0, allowance: 30, reviewed: 0, remaining: 30 });
  });

  it("subtracts reviews logged today", async () => {
    const id = await insertItem();
    await insertReview(id);
    await insertReview(id);
    const b = await getDailyBudget("UTC");
    expect(b.reviewed).toBe(2);
    expect(b.remaining).toBe(28);
  });

  it("ignores reviews from previous days", async () => {
    const id = await insertItem();
    await insertReview(id, { hoursAgo: 72 });
    const b = await getDailyBudget("UTC");
    expect(b.reviewed).toBe(0);
    expect(b.remaining).toBe(30);
  });

  it("floors remaining at zero when reviews exceed the allowance", async () => {
    const id = await insertItem();
    for (let i = 0; i < 32; i++) await insertReview(id);
    const b = await getDailyBudget("UTC");
    expect(b.reviewed).toBe(32);
    expect(b.remaining).toBe(0);
  });

  it("honours a changed target", async () => {
    await pool.query(`UPDATE app_settings SET daily_review_target = 50`);
    const b = await getDailyBudget("UTC");
    expect(b.target).toBe(50);
    expect(b.allowance).toBe(50);
    expect(b.remaining).toBe(50);
  });

  it("buckets by the caller's timezone, not UTC", async () => {
    const id = await insertItem();

    // Both reviews are anchored to midnight in Pacific/Honolulu (UTC-10, no
    // DST), so the assertions hold at every hour of the real clock. 30 minutes
    // after HST midnight is unambiguously "today" in HST.
    await pool.query(
      `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
       VALUES ($1, (date_trunc('day', now() AT TIME ZONE 'Pacific/Honolulu') + interval '30 minutes')
                     AT TIME ZONE 'Pacific/Honolulu', 'got_it', 1, 2)`,
      [id],
    );
    expect((await getDailyBudget("Pacific/Honolulu")).reviewed).toBe(1);

    // 30 minutes *before* that same midnight is the previous HST day and must
    // not be counted. A UTC-bucketing implementation places these two reviews
    // differently (they straddle no UTC boundary — both land on the same UTC
    // date, giving 2) and so fails this assertion.
    await pool.query(
      `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
       VALUES ($1, (date_trunc('day', now() AT TIME ZONE 'Pacific/Honolulu') - interval '30 minutes')
                     AT TIME ZONE 'Pacific/Honolulu', 'got_it', 1, 2)`,
      [id],
    );
    expect((await getDailyBudget("Pacific/Honolulu")).reviewed).toBe(1);
  });
});

describe("unlockRound", () => {
  it("adds one full target to the allowance", async () => {
    const b = await unlockRound("UTC");
    expect(b.extra_rounds).toBe(1);
    expect(b.allowance).toBe(60);
    expect(b.remaining).toBe(60);
  });

  it("is repeatable and accumulates", async () => {
    await unlockRound("UTC");
    await unlockRound("UTC");
    const b = await getDailyBudget("UTC");
    expect(b.extra_rounds).toBe(2);
    expect(b.allowance).toBe(90);
  });

  it("keeps reviews already logged subtracted", async () => {
    const id = await insertItem();
    for (let i = 0; i < 30; i++) await insertReview(id);
    expect((await getDailyBudget("UTC")).remaining).toBe(0);
    const b = await unlockRound("UTC");
    expect(b.remaining).toBe(30);
  });
});

describe("countIntroducedToday", () => {
  it("counts only first-ever reviews from today", async () => {
    const id = await insertItem();
    await insertReview(id, { boxBefore: 0 });               // introduction today
    await insertReview(id, { boxBefore: 2 });               // ordinary review
    await insertReview(id, { boxBefore: 0, hoursAgo: 72 }); // introduction, but not today
    expect(await countIntroducedToday("UTC")).toBe(1);
  });

  it("counts across all skills, not per skill", async () => {
    const v = await insertItem("vocab");
    const g = await insertItem("grammar");
    await insertReview(v, { boxBefore: 0 });
    await insertReview(g, { boxBefore: 0 });
    expect(await countIntroducedToday("UTC")).toBe(2);
  });
});
```

Timezone note: both Honolulu inserts are anchored to HST midnight and cast back with `AT TIME ZONE 'Pacific/Honolulu'`, so they do not depend on Postgres's session `TimeZone` setting or on what hour the suite runs at. Do not "simplify" them to a naive timestamp — inserting a bare `timestamp` into a `timestamptz` column silently reinterprets it in the server's zone.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm --workspace server test -- daily-budget`
Expected: FAIL — `Cannot find module './daily-budget.js'`.

- [ ] **Step 4: Implement the service**

Create `server/src/services/daily-budget.ts`:

```ts
import { pool } from "../db/pool.js";

export const DEFAULT_TARGET = 30;

export type DailyBudget = {
  target: number;        // the configured setting
  extra_rounds: number;  // extra rounds unlocked today
  allowance: number;     // target × (1 + extra_rounds)
  reviewed: number;      // reviews logged today, in `tz`
  remaining: number;     // max(0, allowance − reviewed)
};

async function readTarget(): Promise<number> {
  const r = await pool.query<{ t: number }>(
    `SELECT daily_review_target AS t FROM app_settings LIMIT 1`,
  );
  return r.rows[0]?.t ?? DEFAULT_TARGET;
}

async function readExtraRounds(tz: string): Promise<number> {
  const r = await pool.query<{ n: number }>(
    `SELECT extra_rounds AS n FROM daily_rounds WHERE day = (now() AT TIME ZONE $1)::date`,
    [tz],
  );
  return r.rows[0]?.n ?? 0;
}

async function readReviewedToday(tz: string): Promise<number> {
  const r = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c
       FROM reviews
      WHERE date_trunc('day', reviewed_at AT TIME ZONE $1)
          = date_trunc('day', now() AT TIME ZONE $1)`,
    [tz],
  );
  return r.rows[0]?.c ?? 0;
}

// First-ever reviews (box_before = 0) logged today, across every skill. The
// new-card budget is deliberately global: one daily target means one budget,
// and scoping it per skill would let eight skills each introduce a full share.
export async function countIntroducedToday(tz: string): Promise<number> {
  const r = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c
       FROM reviews
      WHERE box_before = 0
        AND date_trunc('day', reviewed_at AT TIME ZONE $1)
          = date_trunc('day', now() AT TIME ZONE $1)`,
    [tz],
  );
  return r.rows[0]?.c ?? 0;
}

export async function getDailyBudget(tz: string): Promise<DailyBudget> {
  const [target, extra_rounds, reviewed] = await Promise.all([
    readTarget(),
    readExtraRounds(tz),
    readReviewedToday(tz),
  ]);
  const allowance = target * (1 + extra_rounds);
  return { target, extra_rounds, allowance, reviewed, remaining: Math.max(0, allowance - reviewed) };
}

// Unlocks one more full target for today. Repeatable — each call adds a round.
export async function unlockRound(tz: string): Promise<DailyBudget> {
  await pool.query(
    `INSERT INTO daily_rounds (day, extra_rounds)
     VALUES ((now() AT TIME ZONE $1)::date, 1)
     ON CONFLICT (day) DO UPDATE SET extra_rounds = daily_rounds.extra_rounds + 1`,
    [tz],
  );
  return getDailyBudget(tz);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --workspace server test -- daily-budget`
Expected: PASS, all 11 tests.

- [ ] **Step 6: Verify the tz extraction didn't break the queue**

Run: `npm --workspace server test -- queue`
Expected: PASS, unchanged from before this task.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/tz.ts server/src/services/daily-budget.ts server/src/services/daily-budget.test.ts server/src/routes/queue.ts
git commit -m "feat(daily-target): daily budget service + shared resolveTz helper"
```

---

## Task 3: Settings API

**Files:**
- Modify: `server/src/routes/settings.ts` (whole file — it is 8 lines today)
- Test: `server/src/routes/settings.test.ts`

**Interfaces:**
- Consumes: `UpdateSettingsRequest` (Task 1), `DEFAULT_TARGET` (Task 2)
- Produces:
  - `GET /api/settings/status` → `{ ai_key_configured: boolean, daily_review_target: number }`
  - `PATCH /api/settings` with body `{ daily_review_target: number }` → `{ daily_review_target: number }`, 400 `{ error, code: "INVALID_SETTINGS" }` on a bad value

- [ ] **Step 1: Write the failing tests**

`settings.test.ts` currently has no DB usage. Add the imports and `beforeEach` reset, then the new describe block. Replace the file's import header with:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { settingsRouter } from "./settings.js";
```

Add `await resetDb();` to the existing `beforeEach` — change it from
`beforeEach(() => { prev = process.env.ANTHROPIC_API_KEY; });` to:

```ts
beforeEach(async () => {
  prev = process.env.ANTHROPIC_API_KEY;
  await resetDb();
});
```

The three existing `/status` tests assert `res.body` with `toEqual({ ai_key_configured: … })`. Those will now fail because of the added field — update each to include `daily_review_target: 30`. For example the first becomes:

```ts
expect(res.body).toEqual({ ai_key_configured: true, daily_review_target: 30 });
```

Then append:

```ts
describe("PATCH /api/settings", () => {
  it("requires passcode", async () => {
    const res = await request(app).patch("/api/settings").send({ daily_review_target: 40 });
    expect(res.status).toBe(401);
  });

  it("persists a valid target", async () => {
    const res = await request(app)
      .patch("/api/settings").set("X-Passcode", PASSCODE)
      .send({ daily_review_target: 50 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ daily_review_target: 50 });

    const row = await pool.query(`SELECT daily_review_target FROM app_settings`);
    expect(row.rows[0].daily_review_target).toBe(50);
  });

  it("is reflected by GET /status", async () => {
    await request(app).patch("/api/settings").set("X-Passcode", PASSCODE).send({ daily_review_target: 70 });
    const res = await request(app).get("/api/settings/status").set("X-Passcode", PASSCODE);
    expect(res.body.daily_review_target).toBe(70);
  });

  it("rejects out-of-range and non-multiple-of-10 values", async () => {
    for (const n of [0, 5, 25, 105, 30.5, "40", null]) {
      const res = await request(app)
        .patch("/api/settings").set("X-Passcode", PASSCODE)
        .send({ daily_review_target: n });
      expect(res.status, `value ${JSON.stringify(n)} should be rejected`).toBe(400);
      expect(res.body.code).toBe("INVALID_SETTINGS");
    }
    const row = await pool.query(`SELECT daily_review_target FROM app_settings`);
    expect(row.rows[0].daily_review_target).toBe(30);   // unchanged
  });

  it("accepts both ends of the range", async () => {
    for (const n of [10, 100]) {
      const res = await request(app)
        .patch("/api/settings").set("X-Passcode", PASSCODE)
        .send({ daily_review_target: n });
      expect(res.status).toBe(200);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --workspace server test -- settings`
Expected: FAIL — `/status` is missing `daily_review_target`, and every `PATCH` returns 404.

- [ ] **Step 3: Implement the routes**

Replace `server/src/routes/settings.ts` entirely:

```ts
import { Router } from "express";
import { UpdateSettingsRequest } from "@nihongo/shared";
import { pool } from "../db/pool.js";
import { DEFAULT_TARGET } from "../services/daily-budget.js";

export const settingsRouter = Router();

async function readTarget(): Promise<number> {
  const r = await pool.query<{ t: number }>(
    `SELECT daily_review_target AS t FROM app_settings LIMIT 1`,
  );
  return r.rows[0]?.t ?? DEFAULT_TARGET;
}

settingsRouter.get("/status", async (_req, res) => {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  res.json({
    ai_key_configured: key.trim().length > 0,
    daily_review_target: await readTarget(),
  });
});

settingsRouter.patch("/", async (req, res) => {
  const parsed = UpdateSettingsRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "daily_review_target must be a multiple of 10 between 10 and 100",
      code: "INVALID_SETTINGS",
    });
    return;
  }
  const { daily_review_target } = parsed.data;
  await pool.query(
    `UPDATE app_settings SET daily_review_target = $1, updated_at = now()`,
    [daily_review_target],
  );
  res.json({ daily_review_target });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --workspace server test -- settings`
Expected: PASS.

- [ ] **Step 5: Verify the app still mounts the router correctly**

`server/src/index.ts` already mounts `settingsRouter` at `/api/settings`, so `PATCH /` resolves to `PATCH /api/settings`. Confirm by reading the mount line:

Run: `grep -n "settingsRouter" server/src/index.ts`
Expected: a line mounting it at `/api/settings`. If it is mounted somewhere else, adjust the test paths, not the router.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/settings.ts server/src/routes/settings.test.ts
git commit -m "feat(daily-target): expose and update daily_review_target via settings API"
```

---

## Task 4: Dashboard API

**Files:**
- Modify: `server/src/routes/dashboard.ts`
- Test: `server/src/routes/dashboard.test.ts`

**Interfaces:**
- Consumes: `getDailyBudget`, `unlockRound` (Task 2), `resolveTz` (Task 2)
- Produces:
  - `GET /api/dashboard?tz=<iana>` → existing payload plus `daily_target`, `reviewed_today`, `remaining`
  - `POST /api/dashboard/round?tz=<iana>` → the same payload shape, with one more round unlocked

- [ ] **Step 1: Write the failing tests**

Append to `server/src/routes/dashboard.test.ts`. The file already has an `insertItem` helper; add a review helper next to it:

```ts
async function insertReview(itemId: string, boxBefore = 1) {
  await pool.query(
    `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
     VALUES ($1, now(), 'got_it', $2, $2 + 1)`,
    [itemId, boxBefore],
  );
}
```

Then:

```ts
describe("GET /api/dashboard — daily budget", () => {
  it("reports a full allowance when nothing has been reviewed", async () => {
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.daily_target).toBe(30);
    expect(res.body.reviewed_today).toBe(0);
    expect(res.body.remaining).toBe(30);
  });

  it("counts today's reviews against the allowance", async () => {
    const id = await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });
    await insertReview(id);
    await insertReview(id);
    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.reviewed_today).toBe(2);
    expect(res.body.remaining).toBe(28);
  });

  it("reports remaining 0 once the target is met, regardless of backlog", async () => {
    const id = await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });
    for (let i = 0; i < 30; i++) await insertReview(id);
    // A large untouched backlog must not raise `remaining`.
    for (let i = 0; i < 40; i++) await insertItem("grammar");

    const res = await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE);
    expect(res.body.remaining).toBe(0);
    expect(res.body.reviewed_today).toBe(30);
    expect(res.body.by_skill.grammar.new).toBe(40);   // rows stay honest
  });

  it("accepts a tz and falls back to UTC on a bad one", async () => {
    const ok = await request(app).get("/api/dashboard?tz=Asia/Tokyo").set("X-Passcode", PASSCODE);
    expect(ok.status).toBe(200);
    const bad = await request(app).get("/api/dashboard?tz=Not/AZone").set("X-Passcode", PASSCODE);
    expect(bad.status).toBe(200);
    expect(bad.body.daily_target).toBe(30);
  });
});

describe("POST /api/dashboard/round", () => {
  it("requires passcode", async () => {
    const res = await request(app).post("/api/dashboard/round");
    expect(res.status).toBe(401);
  });

  it("unlocks another full target and returns the fresh payload", async () => {
    const id = await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });
    for (let i = 0; i < 30; i++) await insertReview(id);
    expect((await request(app).get("/api/dashboard").set("X-Passcode", PASSCODE)).body.remaining).toBe(0);

    const res = await request(app).post("/api/dashboard/round").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.remaining).toBe(30);
    expect(res.body.reviewed_today).toBe(30);
    expect(res.body.by_skill).toBeDefined();       // full dashboard payload, not a stub
    expect(res.body.streak_days).toBeDefined();
  });

  it("is repeatable", async () => {
    await request(app).post("/api/dashboard/round").set("X-Passcode", PASSCODE);
    const res = await request(app).post("/api/dashboard/round").set("X-Passcode", PASSCODE);
    expect(res.body.remaining).toBe(90);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --workspace server test -- dashboard`
Expected: FAIL — the budget fields are `undefined` and `POST /round` 404s.

- [ ] **Step 3: Implement the route changes**

Rewrite `server/src/routes/dashboard.ts`. Extract the existing body into a `buildPayload(tz)` function so both handlers return the same shape:

```ts
import { Router } from "express";
import { pool } from "../db/pool.js";
import { computeStreak } from "../services/streak.js";
import { getDailyBudget, unlockRound } from "../services/daily-budget.js";
import { resolveTz } from "../services/tz.js";
import type { DailyBudget } from "../services/daily-budget.js";

const SKILLS = ["vocab", "grammar", "reading", "conjugation", "particle", "explain", "listening", "kanji"] as const;

export const dashboardRouter = Router();

async function buildPayload(tz: string, budget: DailyBudget) {
  // Due counts per skill: items with review_state.next_review_at <= now().
  const dueRes = await pool.query<{ skill: string; c: string }>(
    `SELECT i.skill, count(*)::text AS c
       FROM items i JOIN review_state rs ON rs.item_id = i.id
      WHERE rs.next_review_at <= now()
      GROUP BY i.skill`,
  );
  const due = new Map(dueRes.rows.map((r) => [r.skill, Number(r.c)]));

  // New counts per skill: items with no review_state. These stay uncapped on
  // purpose — the hero is bounded by the daily target, but the per-skill rows
  // are the honest inventory of what is left.
  const newRes = await pool.query<{ skill: string; c: string }>(
    `SELECT i.skill, count(*)::text AS c
       FROM items i LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE rs.item_id IS NULL
      GROUP BY i.skill`,
  );
  const fresh = new Map(newRes.rows.map((r) => [r.skill, Number(r.c)]));

  const lastRes = await pool.query<{ ts: Date | null }>(
    `SELECT max(reviewed_at) AS ts FROM reviews`,
  );
  const last = lastRes.rows[0]?.ts ?? null;

  const streakDays = await computeStreak(tz);

  const by_skill: Record<string, { due: number; new: number }> = {};
  for (const s of SKILLS) {
    by_skill[s] = { due: due.get(s) ?? 0, new: fresh.get(s) ?? 0 };
  }

  return {
    streak_days: streakDays,
    last_practiced_at: last ? last.toISOString() : null,
    daily_target: budget.target,
    reviewed_today: budget.reviewed,
    remaining: budget.remaining,
    by_skill,
  };
}

dashboardRouter.get("/", async (req, res) => {
  const tz = resolveTz(req.query.tz);
  res.json(await buildPayload(tz, await getDailyBudget(tz)));
});

// Unlocks one more full target for today. Returns the complete dashboard
// payload so the client can swap state without a second round trip.
dashboardRouter.post("/round", async (req, res) => {
  const tz = resolveTz(req.query.tz);
  res.json(await buildPayload(tz, await unlockRound(tz)));
});
```

Note the streak now uses the caller's tz instead of the hardcoded `"UTC"`. That was a documented compromise in the old comment; passing the real zone is strictly better and `resolveTz` still defaults to UTC when no `tz` arrives.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --workspace server test -- dashboard`
Expected: PASS, including all pre-existing dashboard tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/dashboard.ts server/src/routes/dashboard.test.ts
git commit -m "feat(daily-target): dashboard reports remaining budget + another-round endpoint"
```

---

## Task 5: Queue sizing from the budget

**Files:**
- Modify: `server/src/services/queue.ts`
- Test: `server/src/routes/queue.test.ts`

**Interfaces:**
- Consumes: `getDailyBudget`, `countIntroducedToday` (Task 2)
- Produces: `buildQueue` with unchanged signature `{ limit, skill?, tz } → { due, new }`, now bounded by the daily budget

- [ ] **Step 1: Write the failing tests**

Read `server/src/routes/queue.test.ts` first to reuse its existing helpers rather than duplicating them. Append:

```ts
describe("queue sizing follows the daily target", () => {
  it("serves 10 new + 20 due at the default target of 30", async () => {
    for (let i = 0; i < 40; i++) await insertItem("vocab");                                  // new
    for (let i = 0; i < 40; i++) await insertItem("grammar", { box: 1, nextReviewMinutesAgo: 30 }); // due

    const res = await request(app).get("/api/queue?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.new).toHaveLength(10);
    expect(res.body.due).toHaveLength(20);
  });

  it("scales with a raised target", async () => {
    await pool.query(`UPDATE app_settings SET daily_review_target = 60`);
    for (let i = 0; i < 40; i++) await insertItem("vocab");
    for (let i = 0; i < 60; i++) await insertItem("grammar", { box: 1, nextReviewMinutesAgo: 30 });

    const res = await request(app).get("/api/queue?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.new).toHaveLength(20);          // round(60/3)
    expect(res.body.due).toHaveLength(40);          // 60 − 20
  });

  it("lets due fill the whole cap when no new cards exist", async () => {
    for (let i = 0; i < 40; i++) await insertItem("grammar", { box: 1, nextReviewMinutesAgo: 30 });
    const res = await request(app).get("/api/queue?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.new).toHaveLength(0);
    expect(res.body.due).toHaveLength(30);
  });

  it("returns an empty queue once the target is met", async () => {
    const id = await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });
    for (let i = 0; i < 30; i++) {
      await pool.query(
        `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
         VALUES ($1, now(), 'got_it', 1, 2)`, [id],
      );
    }
    for (let i = 0; i < 20; i++) await insertItem("grammar", { box: 1, nextReviewMinutesAgo: 30 });

    const res = await request(app).get("/api/queue?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.due).toHaveLength(0);
    expect(res.body.new).toHaveLength(0);
  });

  it("shrinks the session to what remains", async () => {
    const id = await insertItem("vocab", { box: 1, nextReviewMinutesAgo: 30 });
    for (let i = 0; i < 25; i++) {
      await pool.query(
        `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
         VALUES ($1, now(), 'got_it', 2, 3)`, [id],
      );
    }
    for (let i = 0; i < 40; i++) await insertItem("grammar", { box: 1, nextReviewMinutesAgo: 30 });

    const res = await request(app).get("/api/queue?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body.due.length + res.body.new.length).toBe(5);
  });

  it("spends the new-card budget globally, not per skill", async () => {
    for (let i = 0; i < 20; i++) await insertItem("vocab");
    for (let i = 0; i < 20; i++) await insertItem("grammar");

    // Introduce 10 new vocab cards, exhausting the global new budget.
    const vocab = await request(app).get("/api/queue?skill=vocab&tz=UTC").set("X-Passcode", PASSCODE);
    expect(vocab.body.new).toHaveLength(10);
    for (const item of vocab.body.new) {
      await pool.query(
        `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
         VALUES ($1, now(), 'got_it', 0, 1)`, [item.id],
      );
    }

    // Grammar must now get zero new cards — the budget is shared, not per skill.
    const grammar = await request(app).get("/api/queue?skill=grammar&tz=UTC").set("X-Passcode", PASSCODE);
    expect(grammar.body.new).toHaveLength(0);
  });
});
```

If `queue.test.ts`'s existing `insertItem` helper has a different signature than `insertItem(skill, { box, nextReviewMinutesAgo })`, adapt these calls to the real one — do not add a second helper.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --workspace server test -- queue`
Expected: FAIL. The default-target case may already pass by coincidence (the old constants give the same 10/20 split), but the raised-target, empty-at-target, due-fills-cap, shrink, and global-budget cases all fail.

- [ ] **Step 3: Rewrite the queue sizing**

In `server/src/services/queue.ts`, delete the `DAILY_NEW_CAP` and `DUE_CAP` constants (lines 4-5) and the inline `introducedToday` query, and replace `buildQueue` with:

```ts
export async function buildQueue(
  opts: { limit: number; skill?: string; tz: string },
): Promise<{ due: ItemRecord[]; new: ItemRecord[] }> {
  const skillFilter = opts.skill ?? null;

  // Session size comes from the daily budget, so the number on the dashboard
  // hero and the session it starts can never disagree.
  const budget = await getDailyBudget(opts.tz);
  const sessionCap = Math.min(opts.limit, budget.remaining);
  if (sessionCap <= 0) return { due: [], new: [] };

  // New cards get a third of the target per round — at the default 30 that is
  // the 10/day this app has always used. Fetched first so that when no new
  // cards are left, due fills the whole cap instead of stopping short.
  const introducedToday = await countIntroducedToday(opts.tz);
  const newShare = Math.round(budget.target / 3) * (1 + budget.extra_rounds);
  const newLimit = Math.max(0, Math.min(sessionCap, newShare - introducedToday));

  let neu: ItemRecord[] = [];
  if (newLimit > 0) {
    const newRes = await pool.query<Row>(
      `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.tags, i.created_at
         FROM items i
         LEFT JOIN review_state rs ON rs.item_id = i.id
        WHERE ($1::text IS NULL OR i.skill = $1) AND rs.item_id IS NULL
        ORDER BY i.created_at ASC
        LIMIT $2`,
      [skillFilter, newLimit],
    );
    neu = newRes.rows.map(toRecord);
  }

  // Due: a random sample of currently-due, non-suspended items, filling
  // whatever the new cards left of the session cap.
  const dueLimit = sessionCap - neu.length;
  let due: ItemRecord[] = [];
  if (dueLimit > 0) {
    const dueRes = await pool.query<Row>(
      `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.tags, i.created_at
         FROM items i
         JOIN review_state rs ON rs.item_id = i.id
        WHERE ($1::text IS NULL OR i.skill = $1)
          AND rs.next_review_at <= now()
          AND rs.suspended = false
        ORDER BY random()
        LIMIT $2`,
      [skillFilter, dueLimit],
    );
    due = dueRes.rows.map(toRecord);
  }

  return { due, new: neu };
}
```

Add to the imports at the top of the file:

```ts
import { getDailyBudget, countIntroducedToday } from "./daily-budget.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --workspace server test -- queue`
Expected: PASS, including every pre-existing queue test.

- [ ] **Step 5: Run the whole server + shared suite**

Run: `npm --workspace shared test && npm --workspace server test`
Expected: PASS. Sessions, reviews, lessons and study-list suites all exercise the queue indirectly; if any now fail, the cause is almost certainly a suite that logs 30+ reviews in one test and then expects a non-empty queue. Fix by unlocking a round in that test's setup, not by loosening the cap.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/queue.ts server/src/routes/queue.test.ts
git commit -m "feat(daily-target): size practice sessions from the daily budget"
```

---

## Task 6: Client API hooks and the Settings stepper

**Files:**
- Modify: `client/src/api-hooks.ts:39-41` (fetchDashboard), `client/src/api-hooks.ts:97-99` (fetchSettingsStatus area)
- Modify: `client/src/screens/SettingsScreen.tsx`
- Modify: `client/src/styles/screens.css`

**Interfaces:**
- Consumes: `PATCH /api/settings` (Task 3), `POST /api/dashboard/round` (Task 4), `SettingsStatusResponse` and `DashboardResponse` (Task 1)
- Produces:
  - `fetchDashboard(): Promise<DashboardResponse>` — now sends `tz`
  - `unlockAnotherRound(): Promise<DashboardResponse>`
  - `updateDailyTarget(n: number): Promise<{ daily_review_target: number }>`

There are no client unit tests in this repo (`npm test` covers shared, gen, seed, server only). Verification here is typecheck + build + a manual pass.

- [ ] **Step 1: Add the API hooks**

In `client/src/api-hooks.ts`, replace `fetchDashboard` (lines 39-41) with:

```ts
function browserTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function fetchDashboard(): Promise<DashboardResponse> {
  return api<DashboardResponse>(`/api/dashboard?tz=${encodeURIComponent(browserTz())}`);
}

// Unlocks one more full daily target. Returns the refreshed dashboard payload
// so the caller can swap state without a second fetch.
export function unlockAnotherRound(): Promise<DashboardResponse> {
  return api<DashboardResponse>(`/api/dashboard/round?tz=${encodeURIComponent(browserTz())}`, {
    method: "POST",
  });
}
```

`fetchQueue` and `fetchStreak` already compute the zone inline; leave them as they are rather than refactoring them into `browserTz` — that is out of scope for this change.

Next to `fetchSettingsStatus` (around line 97), add:

```ts
export function updateDailyTarget(daily_review_target: number): Promise<{ daily_review_target: number }> {
  return api<{ daily_review_target: number }>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({ daily_review_target }),
  });
}
```

- [ ] **Step 2: Add the stepper styles**

Append to `client/src/styles/screens.css`, immediately after the `.settings__pill--err` rule (around line 615):

```css
/* Daily target stepper — a settings row control, not a form field. */
.settings__stepper { display: flex; align-items: center; gap: 4px; }
.settings__stepper-btn {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: var(--font-ui); font-size: 18px; line-height: 1;
  color: var(--fg); cursor: pointer;
}
.settings__stepper-btn:not(:disabled):hover { background: var(--bg-raised); }
.settings__stepper-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.settings__stepper-value {
  min-width: 44px; text-align: center;
  font-family: var(--font-display); font-size: 19px; font-weight: 600;
  letter-spacing: -0.02em; font-variant-numeric: tabular-nums;
}
.settings__row-hint {
  display: block;
  font-size: 12px; color: var(--fg-tertiary);
  margin-top: 2px;
}
.settings__row--stacked { align-items: flex-start; }
.settings__row--stacked .settings__row-label { padding-top: 4px; }
```

`font-variant-numeric: tabular-nums` keeps the number from shifting width between 90 and 100.

- [ ] **Step 3: Add the Practice section to Settings**

In `client/src/screens/SettingsScreen.tsx`:

Extend the imports:

```ts
import { fetchGenerations, fetchSettingsStatus, updateDailyTarget } from "../api-hooks";
```

Add state next to the existing `useState` calls:

```ts
const [target, setTarget] = useState<number | null>(null);
const [targetError, setTargetError] = useState<string | null>(null);
```

In the existing `useEffect`, capture the target alongside the key:

```ts
.then(([status, gens]) => {
  if (cancelled) return;
  setKeyConfigured(status.ai_key_configured);
  setTarget(status.daily_review_target);
  setGenerations(gens.generations);
})
```

Add the handler below `signOut`:

```ts
// Optimistic: the number moves immediately, and reverts if the PATCH fails.
function stepTarget(delta: number) {
  if (target === null) return;
  const next = Math.min(100, Math.max(10, target + delta));
  if (next === target) return;
  const prevTarget = target;
  setTarget(next);
  setTargetError(null);
  updateDailyTarget(next).catch(() => {
    setTarget(prevTarget);
    setTargetError("Couldn't save — try again.");
  });
}
```

Insert a new section between the "Account" section and "Add a word":

```tsx
<div className="settings__section">
  <h2 className="settings__section-title">Practice</h2>
  <div className="settings__list">
    <div className="settings__row settings__row--stacked">
      <span className="settings__row-label">
        Daily review target
        <span className="settings__row-hint">
          Cards per day before you're done. Steps of 10.
        </span>
        {targetError && <span className="settings__row-hint" role="alert">{targetError}</span>}
      </span>
      {target === null ? (
        <span className="muted">Checking…</span>
      ) : (
        <div className="settings__stepper">
          <button
            type="button" className="settings__stepper-btn"
            onClick={() => stepTarget(-10)} disabled={target <= 10}
            aria-label="Decrease daily review target"
          >−</button>
          <span className="settings__stepper-value" aria-live="polite">{target}</span>
          <button
            type="button" className="settings__stepper-btn"
            onClick={() => stepTarget(10)} disabled={target >= 100}
            aria-label="Increase daily review target"
          >+</button>
        </div>
      )}
    </div>
  </div>
</div>
```

The `−` is a Unicode minus (U+2212), not a hyphen — it matches the visual weight of `+`.

- [ ] **Step 4: Typecheck and build**

Run: `npm --workspace client run build`
Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Verify by hand**

```bash
npm run db:up && npm run db:migrate && npm run dev
```

Open http://localhost:5173, sign in, go to Settings. Confirm:
- The Practice section shows "Daily review target" with a value of 30
- `+` steps to 40, 50, … and disables at 100; `−` steps down and disables at 10
- Reloading the page keeps the changed value (it persisted)

Set it back to 30 before moving on.

- [ ] **Step 6: Commit**

```bash
git add client/src/api-hooks.ts client/src/screens/SettingsScreen.tsx client/src/styles/screens.css
git commit -m "feat(daily-target): daily review target stepper in Settings"
```

---

## Task 7: Dashboard hero states

**Files:**
- Modify: `client/src/screens/DashboardScreen.tsx:31` and `:65-78`
- Modify: `client/src/styles/screens.css`
- Test: `e2e/tests/smoke.spec.ts`

**Interfaces:**
- Consumes: `fetchDashboard`, `unlockAnotherRound` (Task 6); `DashboardResponse.remaining` / `.reviewed_today` (Task 1)
- Produces: the finished feature — no downstream consumers

- [ ] **Step 1: Add the congratulation styles**

Append to `client/src/styles/screens.css`, after the existing `.today__hero-empty` rule (around line 85-90):

```css
/* Target met. Sits inside .today__hero, so it inherits the raised card and
   the radial accent wash. */
.today__hero-done {
  position: relative;
  font-family: var(--font-jp);
  font-size: 30px;
  line-height: 1.2;
  color: var(--fg);
  margin: 0 0 6px;
}
.today__hero-done-sub {
  position: relative;
  font-size: 14px;
  color: var(--fg-secondary);
  margin: 0 0 22px;
}
```

- [ ] **Step 2: Rewrite the hero**

In `client/src/screens/DashboardScreen.tsx`:

Extend the import:

```ts
import { fetchDashboard, fetchTodayLesson, unlockAnotherRound } from "../api-hooks";
```

Add state next to the existing `useState` calls:

```ts
const [rounding, setRounding] = useState(false);
```

Add the handler after `load`:

```ts
// Unlocks one more full target. The response is a complete dashboard payload,
// so it replaces state directly instead of triggering a refetch.
async function anotherRound() {
  setRounding(true);
  try {
    setData(await unlockAnotherRound());
  } catch (err) {
    setError(err instanceof Error ? err.message : "couldn't start another round");
  } finally {
    setRounding(false);
  }
}
```

Replace the `totalDue` line (line 31) with:

```ts
// The honest inventory across every skill…
const pool = SKILL_ORDER.reduce((acc, s) => acc + data.by_skill[s].due + data.by_skill[s].new, 0);
// …clamped to what today's budget still allows. This is the motivational number.
const heroCount = Math.min(data.remaining, pool);
```

Replace the whole `<section className="today__hero">` block (lines 65-78) with:

```tsx
<section className="today__hero">
  {pool === 0 ? (
    <>
      <p className="today__hero-label">Ready to review</p>
      <p className="today__hero-count">0</p>
      <p className="today__hero-empty">全部終わり — all caught up. Generate more in Settings.</p>
    </>
  ) : data.remaining === 0 ? (
    <>
      <p className="today__hero-label">Today's target</p>
      <p className="today__hero-done">今日の分、終わり</p>
      <p className="today__hero-done-sub">
        {data.reviewed_today} reviewed today — you're done. {pool} still in the deck whenever you want them.
      </p>
      <button
        type="button" className="cta cta--primary cta--lg today__hero-cta"
        onClick={anotherRound} disabled={rounding}
      >
        {rounding ? "Dealing another round…" : `Go another round (+${data.daily_target})`}
      </button>
    </>
  ) : (
    <>
      <p className="today__hero-label">Ready to review</p>
      <p className="today__hero-count">{heroCount}</p>
      <p className="today__hero-sub">cards across all skills &nbsp;·&nbsp; <span className="jp">混合練習</span></p>
      <button type="button" className="cta cta--primary cta--lg today__hero-cta" onClick={() => onPractice(undefined)}>
        Start mixed practice
      </button>
    </>
  )}
</section>
```

Branch order matters. `pool === 0` is checked first so an empty deck never offers a round that would come back with nothing. A met target then shows the congratulation even when a backlog exists — that is the entire point of the feature.

The `Skills` section below is untouched: the per-skill rows keep their raw counts in every state.

- [ ] **Step 3: Typecheck and build**

Run: `npm --workspace client run build`
Expected: PASS.

- [ ] **Step 4: Add an e2e test for the congratulation state**

Read `e2e/tests/helpers.ts` and `e2e/tests/fixtures.ts` first to see what `login` and `loadFixture` provide. Append to `e2e/tests/smoke.spec.ts`:

```ts
test("daily review target stepper clamps at its minimum", async ({ page }) => {
  await login(page);

  // Drive the target down to its 10 minimum so the fixture deck can meet it.
  await page.goto("/");
  await page.getByRole("button", { name: /settings/i }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: /decrease daily review target/i }).click();
  }
  await expect(page.locator(".settings__stepper-value")).toHaveText("10");
});
```

This asserts the stepper reaches its floor. Driving 10 real reviews through the UI would be slow and duplicate the server-side coverage in `dashboard.test.ts`; the congratulation copy itself is verified by hand in Step 5.

If `loadFixture("seed-test-items")` in the file's `beforeEach` does not leave the app on a screen with a visible Settings button, adjust the navigation — do not change the fixture.

- [ ] **Step 5: Verify by hand**

```bash
npm run db:up && npm run db:migrate && npm run dev
```

With the app running:
1. Today shows "Ready to review" with a number ≤ 30, not the full backlog.
2. Set the target to 10 in Settings, return to Today — the number is ≤ 10.
3. Complete a session of 10 reviews. Today now shows 今日の分、終わり, "10 reviewed today", and "Go another round (+10)".
4. Click it — the hero returns to "Ready to review" with a fresh count, and mixed practice serves cards again.
5. Skill rows still show their real backlog throughout.
6. Reset the target to 30.

- [ ] **Step 6: Run everything**

```bash
npm test
npm --workspace client run build
```

Expected: all suites PASS, client builds clean.

- [ ] **Step 7: Commit**

```bash
git add client/src/screens/DashboardScreen.tsx client/src/styles/screens.css e2e/tests/smoke.spec.ts
git commit -m "feat(daily-target): bounded Today hero with congratulation and another-round"
```

---

## Done criteria

- Today's hero never shows more than the daily target (default 30), regardless of backlog size.
- Meeting the target replaces the number with 今日の分、終わり and a "Go another round" button that unlocks exactly one more target, repeatably.
- Settings has a Practice section stepping the target by 10 between 10 and 100, persisted server-side.
- Practice sessions are sized by the same budget the hero displays — they shrink as the day fills up and return empty at zero.
- Per-skill rows still show raw due/new counts.
- `npm test` and `npm --workspace client run build` both pass.
