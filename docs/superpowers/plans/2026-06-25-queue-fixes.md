# Queue Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop short, infrequent practice sessions from replaying the same overdue cards while never reaching new material, by fixing the queue selection policy (the spaced-repetition math is already correct).

**Architecture:** Three independent changes to queue selection in `server/src/services/queue.ts` plus a leech-suspension write in `server/src/routes/reviews.ts`: (1) always serve new items up to a per-day budget counted from review history, (2) randomly sample and cap the due set, (3) hide items missed ≥ 8 times via a new `review_state.suspended` column.

**Tech Stack:** TypeScript, Express, PostgreSQL (via `pg`), node-pg-migrate (SQL migrations), Vitest + supertest. React client.

## Global Constraints

- Daily new-item cap: **10** per calendar day, counted in the caller's timezone, scoped to the queue's skill filter.
- Due cap per session: **20**.
- Leech suspension threshold: **8** total misses (one-way; no revive UI in this plan).
- Due ordering: `ORDER BY random()` (plain shuffle, no overdue priority).
- Timezone: `GET /api/queue` accepts optional `tz` (IANA name); invalid/missing → `UTC`.
- Tests need a migrated DB. Run `npm run db:migrate` (in `server/`) before `npm test` if the schema changed.
- Follow existing patterns: SQL migrations are plain `ALTER`/`CREATE` files named `<epoch_ms>_<name>.sql`; DB tests use `makeTestApp` + `resetDb` + supertest.

---

### Task 1: Add `suspended` column to `review_state`

**Files:**
- Create: `db/migrations/1782950400000_review_state_suspended.sql`

**Interfaces:**
- Produces: `review_state.suspended boolean NOT NULL DEFAULT false`, consumed by Tasks 2 and 3.

- [ ] **Step 1: Write the migration**

Create `db/migrations/1782950400000_review_state_suspended.sql`:

```sql
-- 1782950400000_review_state_suspended.sql
-- Auto-suspend chronic leeches. Items missed >= 8 times are hidden from the
-- queue (see queue.ts / reviews.ts) until manually revived. A revive UI is
-- future work; for now suspension is one-way.
ALTER TABLE review_state ADD COLUMN suspended boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Run the migration and verify the column exists**

Run (from `server/`):
```bash
npm run db:migrate
```
Then verify:
```bash
psql "$DATABASE_URL" -c "\d review_state" | grep suspended
```
Expected: a line showing `suspended | boolean | not null` (default false).

- [ ] **Step 3: Commit**

```bash
git add db/migrations/1782950400000_review_state_suspended.sql
git commit -m "feat(db): add review_state.suspended for leech suspension"
```

---

### Task 2: Suspend leeches at 8 misses in the reviews route

**Files:**
- Modify: `server/src/routes/reviews.ts` (the `review_state` upsert, ~lines 77-87)
- Test: `server/src/routes/reviews.test.ts`

**Interfaces:**
- Consumes: `review_state.suspended` (Task 1).
- Produces: review POSTs set `suspended = true` whenever `total_missed >= 8`.

- [ ] **Step 1: Write the failing tests**

Add these two cases inside the `describe("POST /api/reviews", ...)` block in `server/src/routes/reviews.test.ts`:

```ts
  it("suspends an item when total_missed reaches 8", async () => {
    const itemId = await insertItem();
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, total_reviews, total_missed)
       VALUES ($1, 1, now() - interval '1 hour', 10, 7)`,
      [itemId],
    );
    await request(app)
      .post("/api/reviews")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "missed", reviewed_at: new Date().toISOString() });
    const r = await pool.query(`SELECT total_missed, suspended FROM review_state WHERE item_id = $1`, [itemId]);
    expect(r.rows[0].total_missed).toBe(8);
    expect(r.rows[0].suspended).toBe(true);
  });

  it("does not suspend below 8 misses", async () => {
    const itemId = await insertItem();
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, total_reviews, total_missed)
       VALUES ($1, 1, now() - interval '1 hour', 10, 6)`,
      [itemId],
    );
    await request(app)
      .post("/api/reviews")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "missed", reviewed_at: new Date().toISOString() });
    const r = await pool.query(`SELECT total_missed, suspended FROM review_state WHERE item_id = $1`, [itemId]);
    expect(r.rows[0].total_missed).toBe(7);
    expect(r.rows[0].suspended).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `server/`):
```bash
npm test -- reviews.test.ts
```
Expected: the two new tests FAIL — `suspended` column not written (value stays `false` at 8 misses), or the query errors if Task 1 wasn't migrated into the test DB.

- [ ] **Step 3: Implement the suspension write**

In `server/src/routes/reviews.ts`, replace the `review_state` upsert (currently lines 77-87) with this version, which computes `suspended` and writes it:

```ts
    const suspended = next.total_missed >= 8;

    // Upsert review_state
    await client.query(
      `INSERT INTO review_state (item_id, box, next_review_at, last_reviewed_at, total_reviews, total_missed, suspended)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (item_id) DO UPDATE
         SET box = EXCLUDED.box,
             next_review_at = EXCLUDED.next_review_at,
             last_reviewed_at = EXCLUDED.last_reviewed_at,
             total_reviews = EXCLUDED.total_reviews,
             total_missed = EXCLUDED.total_missed,
             suspended = EXCLUDED.suspended`,
      [item_id, next.box, next.next_review_at, next.last_reviewed_at, next.total_reviews, next.total_missed, suspended],
    );
```

Note: once `total_missed >= 8`, `suspended` stays `true` on every later review (including `got_it`, which leaves `total_missed` unchanged). That is intentional — suspension is one-way until a future manual revive.

- [ ] **Step 4: Run tests to verify they pass**

Run (from `server/`):
```bash
npm test -- reviews.test.ts
```
Expected: PASS (all reviews tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/reviews.ts server/src/routes/reviews.test.ts
git commit -m "feat(reviews): suspend items after 8 total misses"
```

---

### Task 3: Rewrite queue selection (daily new budget, shuffled+capped due, exclude suspended)

**Files:**
- Modify: `server/src/services/queue.ts` (whole `buildQueue` function + add constants)
- Modify: `server/src/routes/queue.ts` (pass `tz`, add `resolveTz`)
- Test: `server/src/routes/queue.test.ts` (update broken cases, add new ones)

**Interfaces:**
- Consumes: `review_state.suspended` (Task 1); the `reviews.box_before` column (existing) to count today's new-item intake.
- Produces: `buildQueue(opts: { limit: number; skill?: string; tz: string }): Promise<{ due: ItemRecord[]; new: ItemRecord[] }>`.

- [ ] **Step 1: Update existing queue tests that the new behavior breaks**

In `server/src/routes/queue.test.ts`:

(a) Replace the test `"returns due items ordered by next_review_at ASC"` with an order-independent version (due is now shuffled):

```ts
  it("returns all currently-due items (order not significant)", async () => {
    const a = await insertItem({ external_id: "a", box: 1, nextReviewMinutesAgo: 30 });
    const b = await insertItem({ external_id: "b", box: 1, nextReviewMinutesAgo: 60 });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    const ids = res.body.due.map((i: { id: string }) => i.id);
    expect(new Set(ids)).toEqual(new Set([a, b]));
  });
```

(b) Replace the test `"does NOT include new items when due.length >= 10"` (new items now appear regardless of due count):

```ts
  it("serves new items even when the due backlog is large", async () => {
    for (let i = 0; i < 12; i++) await insertItem({ external_id: `due-${i}`, box: 1, nextReviewMinutesAgo: i + 1 });
    for (let i = 0; i < 3; i++) await insertItem({ external_id: `new-${i}` });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.body.new).toHaveLength(3);
  });
```

(c) Rename `"includes new items only when due.length < 10"` to `"serves both due and new items"` (assertions unchanged — they still hold):

```ts
  it("serves both due and new items", async () => {
    for (let i = 0; i < 5; i++) await insertItem({ external_id: `due-${i}`, box: 1, nextReviewMinutesAgo: i + 1 });
    for (let i = 0; i < 3; i++) await insertItem({ external_id: `new-${i}` });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.due).toHaveLength(5);
    expect(res.body.new).toHaveLength(3);
  });
```

(d) Rename `"caps new items at 10"` to `"serves up to 10 new items per day"` (assertions unchanged).

- [ ] **Step 2: Add new test cases for the new behavior**

First add a helper near the existing `insertItem` in `server/src/routes/queue.test.ts` that records a brand-new exposure today (a `reviews` row with `box_before = 0`):

```ts
async function recordNewExposureToday(itemId: string) {
  await pool.query(
    `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
     VALUES ($1, now(), 'got_it', 0, 1)`,
    [itemId],
  );
}
```

Then add these cases inside the `describe("GET /api/queue", ...)` block:

```ts
  it("counts new items introduced today against the daily cap", async () => {
    // 4 already introduced today -> only 6 of the 25 fresh items should be served
    for (let i = 0; i < 4; i++) {
      const id = await insertItem({ external_id: `seen-${i}`, box: 1, nextReviewMinutesAgo: 120 });
      await recordNewExposureToday(id);
    }
    for (let i = 0; i < 25; i++) await insertItem({ external_id: `fresh-${i}` });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.body.new).toHaveLength(6);
  });

  it("excludes suspended items from the due queue", async () => {
    const live = await insertItem({ external_id: "live", box: 1, nextReviewMinutesAgo: 30 });
    const dead = await insertItem({ external_id: "dead", box: 1, nextReviewMinutesAgo: 30 });
    await pool.query(`UPDATE review_state SET suspended = true WHERE item_id = $1`, [dead]);
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    const ids = res.body.due.map((i: { id: string }) => i.id);
    expect(ids).toContain(live);
    expect(ids).not.toContain(dead);
  });

  it("caps the due queue at 20", async () => {
    for (let i = 0; i < 25; i++) await insertItem({ external_id: `due-${i}`, box: 1, nextReviewMinutesAgo: i + 1 });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.body.due).toHaveLength(20);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run (from `server/`):
```bash
npm test -- queue.test.ts
```
Expected: the new/updated cases FAIL — current `buildQueue` gates new items on `due.length < 10`, orders due by `next_review_at ASC` with no cap at 20, and ignores `suspended`. (The `tz`-less route still works, so existing passing tests stay green until this step's edits.)

- [ ] **Step 4: Rewrite `buildQueue`**

Replace the entire body of `server/src/services/queue.ts` with:

```ts
import { pool } from "../db/pool.js";
import type { ItemRecord } from "@nihongo/shared";

const DAILY_NEW_CAP = 10;
const DUE_CAP = 20;

type Row = {
  id: string;
  skill: string;
  prompt: unknown;
  answer: unknown;
  source: string;
  tags: string[];
  created_at: Date;
};

function toRecord(r: Row): ItemRecord {
  return {
    id: r.id,
    skill: r.skill as ItemRecord["skill"],
    prompt: r.prompt as ItemRecord["prompt"],
    answer: r.answer as ItemRecord["answer"],
    source: r.source as ItemRecord["source"],
    tags: r.tags,
    created_at: r.created_at.toISOString(),
  };
}

export async function buildQueue(
  opts: { limit: number; skill?: string; tz: string },
): Promise<{ due: ItemRecord[]; new: ItemRecord[] }> {
  const skillFilter = opts.skill ?? null;

  // Due: a random sample of currently-due, non-suspended items, capped per session.
  const dueLimit = Math.min(opts.limit, DUE_CAP);
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
  const due = dueRes.rows.map(toRecord);

  // New: serve up to (DAILY_NEW_CAP - introduced today) brand-new items,
  // independent of the due backlog. "Introduced today" = first-ever reviews
  // (box_before = 0) bucketed by calendar day in the caller's timezone, scoped
  // to the same skill filter the queue is serving.
  const introRes = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c
       FROM reviews r
       JOIN items i ON i.id = r.item_id
      WHERE r.box_before = 0
        AND ($2::text IS NULL OR i.skill = $2)
        AND date_trunc('day', r.reviewed_at AT TIME ZONE $1)
          = date_trunc('day', now() AT TIME ZONE $1)`,
    [opts.tz, skillFilter],
  );
  const introducedToday = introRes.rows[0]?.c ?? 0;
  const newBudget = Math.max(0, DAILY_NEW_CAP - introducedToday);

  let neu: ItemRecord[] = [];
  if (newBudget > 0) {
    const newRes = await pool.query<Row>(
      `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.tags, i.created_at
         FROM items i
         LEFT JOIN review_state rs ON rs.item_id = i.id
        WHERE ($1::text IS NULL OR i.skill = $1) AND rs.item_id IS NULL
        ORDER BY i.created_at ASC
        LIMIT $2`,
      [skillFilter, newBudget],
    );
    neu = newRes.rows.map(toRecord);
  }

  return { due, new: neu };
}
```

Note: brand-new items have no `review_state` row, so they can never be suspended — the new-item query needs no `suspended` filter.

- [ ] **Step 5: Update the queue route to pass `tz`**

Replace the body of `server/src/routes/queue.ts` with:

```ts
import { Router } from "express";
import { buildQueue } from "../services/queue.js";

export const queueRouter = Router();

const SUPPORTED_SKILLS = new Set(["vocab", "grammar", "particle", "conjugation", "reading", "explain"]);

function resolveTz(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "UTC";
  try {
    // Throws RangeError on an invalid IANA zone name.
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return "UTC";
  }
}

queueRouter.get("/", async (req, res) => {
  const skillParam = req.query.skill;
  let skill: string | undefined;
  if (skillParam !== undefined) {
    if (typeof skillParam !== "string" || !SUPPORTED_SKILLS.has(skillParam)) {
      res.status(400).json({ error: `unsupported skill: ${skillParam}`, code: "SKILL_UNSUPPORTED" });
      return;
    }
    skill = skillParam;
  }
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 500);
  const tz = resolveTz(req.query.tz);
  const payload = await buildQueue({ limit, skill, tz });
  res.json(payload);
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run (from `server/`):
```bash
npm test -- queue.test.ts
```
Expected: PASS (all queue tests, updated and new).

- [ ] **Step 7: Run the full server test suite and typecheck**

Run (from `server/`):
```bash
npm test && npm run build
```
Expected: all tests PASS; `tsc --noEmit` reports no errors.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/queue.ts server/src/routes/queue.ts server/src/routes/queue.test.ts
git commit -m "feat(queue): daily new-item budget, shuffled+capped due, exclude suspended"
```

---

### Task 4: Client passes timezone to the queue endpoint

**Files:**
- Modify: `client/src/api-hooks.ts` (`fetchQueue`, ~lines 25-28)

**Interfaces:**
- Consumes: `GET /api/queue?tz=<IANA>` (Task 3).

- [ ] **Step 1: Update `fetchQueue` to send `tz`**

In `client/src/api-hooks.ts`, replace the `fetchQueue` function with:

```ts
export function fetchQueue(skill?: Skill): Promise<QueueResponse> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const params = new URLSearchParams({ tz });
  if (skill) params.set("skill", skill);
  return api<QueueResponse>(`/api/queue?${params.toString()}`);
}
```

- [ ] **Step 2: Typecheck the client**

Run (from `client/`):
```bash
npm run build
```
Expected: build succeeds (no TypeScript errors).

- [ ] **Step 3: Commit**

```bash
git add client/src/api-hooks.ts
git commit -m "feat(client): send timezone to queue for daily new-item budget"
```

---

## Self-Review Notes

- **Spec coverage:** Change 1 (daily new guarantee) → Task 3 Steps 4-5 + Task 4. Change 2 (shuffle + cap 20) → Task 3 Step 4. Change 3 (leech suspension) → Tasks 1 & 2. API `tz` param → Task 3 Step 5 + Task 4. Migration → Task 1. All covered.
- **Refinement vs spec:** the "introduced today" count is scoped to the queue's skill filter (not purely global), so each skill gets its own daily budget consistent with what the filtered queue serves. This matches how the client always queries a single skill.
- **Type consistency:** `buildQueue` signature `{ limit, skill?, tz }` is defined in Task 3 and consumed only by the queue route (verified sole caller). `suspended` column name is consistent across Tasks 1-3.
- **DB-dependent tests:** Tasks 2 and 3 require the Task 1 migration applied to the test database (`npm run db:migrate`).
