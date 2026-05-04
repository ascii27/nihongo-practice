# Phase 1 — Vocab Review Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app usable for daily vocab review on iPhone — items table + Leitner state machine + queue/reviews/sessions/streak endpoints + seed importer for the owner's XML deck + Today/Practice screens with FlipCard. Vocab skill only.

**Architecture:** Builds on the Phase 0 monorepo. New code goes into `db/migrations/`, `server/src/{routes,services,db}/`, `client/src/{screens,components,api}/`, plus a new top-level `seed/` workspace for the one-shot import script. Existing Phase 0 plumbing (passcode middleware, design tokens, deploy script, Playwright smoke) is unchanged.

**Tech Stack:** Node 24, TypeScript 5.x, Express, pg, node-pg-migrate, Vitest + supertest, Vite + React 18, fast-xml-parser, kuromoji, @anthropic-ai/sdk, sanitize-html, Playwright.

**Branch:** All Phase 1 work happens on `feat/phase-1-vocab-loop` (already created and the spec is already committed there). The final task opens a PR.

**Spec:** [`docs/superpowers/specs/2026-05-04-phase-1-vocab-loop-design.md`](../specs/2026-05-04-phase-1-vocab-loop-design.md)

---

## File Structure

End state of Phase 1:

```
nihongo-practice/
  db/migrations/
    1746460800000_phase1_tables.sql      # items, review_state, reviews, sessions
  shared/src/
    types.ts                              # extended with vocab schema + API contracts
    sanitize.ts                           # ruby-tag allowlist sanitizer
  server/src/
    db/
      pool.ts                             # (existing)
      reset.ts                            # NEW: test helper to TRUNCATE all tables
    services/
      leitner.ts                          # pure nextState() function
      queue.ts                            # build {due, new} payload
      streak.ts                           # streak day-grouping with tz
    routes/
      auth.ts                             # (existing)
      queue.ts                            # GET /api/queue
      sessions.ts                         # POST/PATCH /api/sessions
      reviews.ts                          # POST /api/reviews
      stats.ts                            # GET /api/stats/streak
    test-helpers/
      app.ts                              # makeTestApp() factory
    index.ts                              # MODIFIED: wire new routers
  seed/                                   # NEW workspace
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      parse-xml.ts                        # XML deck → CardInput[]
      generate.ts                         # batched Claude calls → SentenceOutput[]
      furigana.ts                         # kuromoji wrapper → ruby HTML
      insert.ts                           # ON CONFLICT DO NOTHING upserts
      import.ts                           # orchestrator entry point
      parse-xml.test.ts
      generate.test.ts
  client/src/
    api.ts                                # (existing) unchanged
    api-hooks.ts                          # NEW: fetchQueue, submitReview, etc.
    components/
      RubyText.tsx                        # sanitized ruby renderer
      FlipCard.tsx                        # prompt/answer card
      BottomTabs.tsx                      # 4-tab nav
    screens/
      PasscodeScreen.tsx                  # (existing) unchanged
      TodayScreen.tsx                     # MODIFIED: real data
      PracticeScreen.tsx                  # NEW: session loop
      BrowseScreen.tsx                    # NEW: "coming soon" stub
      StatsScreen.tsx                     # NEW: "coming soon" stub
    App.tsx                               # MODIFIED: tab nav state
    styles/
      cards.css                           # NEW: FlipCard + Today + tabs (from frontend-design skill)
  e2e/tests/
    smoke.spec.ts                         # MODIFIED: extend with vocab review path
    fixtures/seed-test-items.sql          # NEW: a few rows for the smoke test
```

**Why this shape:** Server services are pure functions with single responsibilities (`leitner.nextState`, `queue.buildPayload`, `streak.computeDays`) — easy to unit-test, easy to compose in routes. Routes are thin handlers that call services. The seed importer is a separate workspace because it has different deps (`kuromoji`, `@anthropic-ai/sdk`, `fast-xml-parser`) and a different lifecycle (one-shot CLI, not a long-running server). Client components are small and focused: `RubyText` does sanitizing, `FlipCard` does flipping, `BottomTabs` does navigation — none mixes concerns.

---

## Conventions for every task

- **Working directory:** repo root unless stated otherwise.
- **Branch:** `feat/phase-1-vocab-loop` (already created).
- **Commits:** small, Conventional Commits style.
- **Co-author trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **TDD:** server logic and the importer are test-first. React components without logic don't need unit tests; Playwright covers behavior. The sanitizer (logic) is unit-tested.
- **Stop and ask:** if a step's expected output doesn't match what you see, stop and report. Do not invent fixes.
- **Postgres:** Phase 0 already provisioned `docker compose up -d postgres`. Verify it's running with `docker compose ps` before any task that touches the DB.

---

### Task 1: DB migration — Phase 1 tables

**Files:**
- Create: `db/migrations/1746460800000_phase1_tables.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 1746460800000_phase1_tables.sql
-- Adds the four tables that drive the vocab review loop. pgcrypto was enabled
-- in the Phase 0 initial migration and provides gen_random_uuid().

CREATE TABLE items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill       text NOT NULL CHECK (skill IN ('vocab','grammar','reading','conjugation','particle')),
  prompt      jsonb NOT NULL,
  answer      jsonb NOT NULL,
  source      text NOT NULL CHECK (source IN ('seed','ai','user')),
  external_id text,
  tags        text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE INDEX items_skill_idx ON items (skill);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  skill_filter text
);

CREATE TABLE review_state (
  item_id          uuid PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  box              smallint NOT NULL DEFAULT 1 CHECK (box BETWEEN 1 AND 5),
  next_review_at   timestamptz NOT NULL DEFAULT now(),
  last_reviewed_at timestamptz,
  total_reviews    int NOT NULL DEFAULT 0,
  total_missed     int NOT NULL DEFAULT 0
);

CREATE INDEX review_state_next_review_idx ON review_state (next_review_at);

CREATE TABLE reviews (
  id          bigserial PRIMARY KEY,
  item_id     uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  reviewed_at timestamptz NOT NULL,
  result      text NOT NULL CHECK (result IN ('got_it','missed')),
  box_before  smallint NOT NULL,
  box_after   smallint NOT NULL,
  session_id  uuid REFERENCES sessions(id) ON DELETE SET NULL,
  UNIQUE (item_id, reviewed_at)
);

CREATE INDEX reviews_reviewed_at_idx ON reviews (reviewed_at);
```

- [ ] **Step 2: Run the migration**

```bash
docker compose ps postgres   # confirm it's up
npm --workspace server run db:migrate
```

Expected: log line shows `1746460800000_phase1_tables` migrated up. No errors.

- [ ] **Step 3: Verify the schema**

```bash
docker compose exec -T postgres psql -U nihongo -d nihongo -c "\dt"
```

Expected: rows listing `items`, `review_state`, `reviews`, `sessions`, plus the existing `pgmigrations` table.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/1746460800000_phase1_tables.sql
git commit -m "$(cat <<'EOF'
feat(db): phase 1 tables — items, review_state, reviews, sessions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Shared types — vocab schema + API contracts

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `shared/package.json` (add `sanitize-html`)
- Create: `shared/src/sanitize.ts`
- Create: `shared/src/sanitize.test.ts`

- [ ] **Step 1: Add `sanitize-html` to shared deps**

Edit `shared/package.json` to add to `dependencies`:

```json
  "dependencies": {
    "zod": "^3.23.8",
    "sanitize-html": "^2.13.0"
  },
  "devDependencies": {
    "@types/sanitize-html": "^2.13.0",
    "typescript": "^5.6.0"
  }
```

Then:

```bash
npm install
```

- [ ] **Step 2: Replace `shared/src/types.ts`** (extend the existing file — keep `AuthCheckResponse`)

```ts
import { z } from "zod";

export { sanitizeRuby } from "./sanitize.js";

export const AuthCheckRequest = z.object({}).strict();
export type AuthCheckRequest = z.infer<typeof AuthCheckRequest>;

export const AuthCheckResponse = z.object({ ok: z.literal(true) });
export type AuthCheckResponse = z.infer<typeof AuthCheckResponse>;

// ----- Vocab item -----

export const VocabPrompt = z.object({
  sentence_ruby: z.string(),
  target: z.string(),
  sentence_english: z.string(),
});
export type VocabPrompt = z.infer<typeof VocabPrompt>;

export const VocabAnswer = z.object({
  meaning: z.string(),
  reading: z.string(),
  notes: z.string().optional(),
});
export type VocabAnswer = z.infer<typeof VocabAnswer>;

export const Skill = z.enum(["vocab", "grammar", "reading", "conjugation", "particle"]);
export type Skill = z.infer<typeof Skill>;

export const Source = z.enum(["seed", "ai", "user"]);
export type Source = z.infer<typeof Source>;

export const ItemRecord = z.object({
  id: z.string().uuid(),
  skill: Skill,
  prompt: VocabPrompt,           // Phase 1: vocab only
  answer: VocabAnswer,
  source: Source,
  tags: z.array(z.string()),
  created_at: z.string(),        // ISO
});
export type ItemRecord = z.infer<typeof ItemRecord>;

// ----- API: queue -----

export const QueueResponse = z.object({
  due: z.array(ItemRecord),
  new: z.array(ItemRecord),
});
export type QueueResponse = z.infer<typeof QueueResponse>;

// ----- API: sessions -----

export const StartSessionRequest = z.object({
  skill_filter: Skill.optional(),
});
export type StartSessionRequest = z.infer<typeof StartSessionRequest>;

export const StartSessionResponse = z.object({ id: z.string().uuid() });
export type StartSessionResponse = z.infer<typeof StartSessionResponse>;

export const EndSessionRequest = z.object({
  ended_at: z.string(),  // ISO
});
export type EndSessionRequest = z.infer<typeof EndSessionRequest>;

// ----- API: reviews -----

export const ReviewResult = z.enum(["got_it", "missed"]);
export type ReviewResult = z.infer<typeof ReviewResult>;

export const SubmitReviewRequest = z.object({
  item_id: z.string().uuid(),
  result: ReviewResult,
  reviewed_at: z.string(),       // ISO, client-supplied
  session_id: z.string().uuid().optional(),
});
export type SubmitReviewRequest = z.infer<typeof SubmitReviewRequest>;

export const ReviewStateResponse = z.object({
  box: z.number().int().min(1).max(5),
  next_review_at: z.string(),    // ISO
  total_reviews: z.number().int().nonnegative(),
  total_missed: z.number().int().nonnegative(),
});
export type ReviewStateResponse = z.infer<typeof ReviewStateResponse>;

// ----- API: stats/streak -----

export const StreakResponse = z.object({
  days: z.number().int().nonnegative(),
});
export type StreakResponse = z.infer<typeof StreakResponse>;
```

- [ ] **Step 3: Type-check shared**

```bash
npm --workspace shared run build
```

Expected: exit 0, no diagnostics.

- [ ] **Step 4: Write the failing sanitizer test `shared/src/sanitize.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { sanitizeRuby } from "./sanitize.js";

describe("sanitizeRuby", () => {
  it("preserves valid ruby markup", () => {
    const input = "<ruby>漢字<rt>かんじ</rt></ruby>";
    expect(sanitizeRuby(input)).toBe("<ruby>漢字<rt>かんじ</rt></ruby>");
  });

  it("preserves rp tags", () => {
    const input = "<ruby>日<rp>(</rp><rt>ひ</rt><rp>)</rp></ruby>";
    expect(sanitizeRuby(input)).toBe("<ruby>日<rp>(</rp><rt>ひ</rt><rp>)</rp></ruby>");
  });

  it("strips disallowed tags", () => {
    const input = "<script>alert(1)</script><ruby>日<rt>ひ</rt></ruby>";
    expect(sanitizeRuby(input)).toBe("<ruby>日<rt>ひ</rt></ruby>");
  });

  it("strips attributes from allowed tags", () => {
    const input = `<ruby onclick="x">日<rt class="x">ひ</rt></ruby>`;
    expect(sanitizeRuby(input)).toBe("<ruby>日<rt>ひ</rt></ruby>");
  });

  it("preserves plain text outside tags", () => {
    const input = "今日は<ruby>晴<rt>は</rt></ruby>れです";
    expect(sanitizeRuby(input)).toBe("今日は<ruby>晴<rt>は</rt></ruby>れです");
  });
});
```

(The shared workspace doesn't have vitest; the test runs from the server workspace, which already has it. We'll wire that import in the next step.)

- [ ] **Step 5: Implement `shared/src/sanitize.ts`**

```ts
import sanitizeHtml from "sanitize-html";

export function sanitizeRuby(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: ["ruby", "rt", "rp"],
    allowedAttributes: {},
    disallowedTagsMode: "discard",
  });
}
```

- [ ] **Step 6: Wire the test into the server's vitest config**

Edit `server/vitest.config.ts` to also pick up shared tests:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: [
      "src/**/*.test.ts",
      "../shared/src/**/*.test.ts",
    ],
  },
});
```

- [ ] **Step 7: Run the tests**

```bash
npm --workspace server test
```

Expected: 5 new passing tests in `sanitize.test.ts`. Existing passcode + auth tests still pass.

- [ ] **Step 8: Commit**

```bash
git add shared/ server/vitest.config.ts package-lock.json
git commit -m "$(cat <<'EOF'
feat(shared): vocab schema, API contracts, ruby-tag sanitizer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Server test infrastructure — DB reset helper + app factory

**Files:**
- Create: `server/src/db/reset.ts`
- Create: `server/src/test-helpers/app.ts`

- [ ] **Step 1: Write `server/src/db/reset.ts`**

```ts
import { pool } from "./pool.js";

// Truncates application tables in FK order. Use in test beforeEach.
// pgmigrations is left alone so the schema stays migrated.
export async function resetDb(): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE reviews, review_state, items, sessions
    RESTART IDENTITY CASCADE
  `);
}
```

- [ ] **Step 2: Write `server/src/test-helpers/app.ts`**

```ts
import express from "express";
import type { Express } from "express";
import { passcodeMiddleware } from "../middleware/passcode.js";
import { authRouter } from "../routes/auth.js";

// Creates a test app with the same shape as production but a caller-supplied
// passcode and (later) caller-supplied routers. Each new router lands in
// its own task and gets wired here.
export function makeTestApp(passcode: string, mounts?: (app: Express) => void): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", passcodeMiddleware(passcode));
  app.use("/api/auth", authRouter);
  if (mounts) mounts(app);
  return app;
}
```

- [ ] **Step 3: Verify type-check (no test yet, just compile)**

```bash
npm --workspace server run build
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add server/src/db/reset.ts server/src/test-helpers/
git commit -m "$(cat <<'EOF'
test(server): db reset helper and test app factory

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Leitner state machine (TDD, pure)

**Files:**
- Create: `server/src/services/leitner.test.ts`
- Create: `server/src/services/leitner.ts`

- [ ] **Step 1: Write the failing test `server/src/services/leitner.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { nextState, type ReviewStateRow } from "./leitner.js";

const NOW = new Date("2026-05-04T12:00:00.000Z");
const ONE_DAY = 24 * 60 * 60 * 1000;

function plusDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * ONE_DAY);
}

describe("nextState", () => {
  it("new item, got_it: box=1, next_review = now+1d, no missed", () => {
    const result = nextState(null, "got_it", NOW);
    expect(result.box).toBe(1);
    expect(result.next_review_at).toEqual(plusDays(NOW, 1));
    expect(result.total_reviews).toBe(1);
    expect(result.total_missed).toBe(0);
    expect(result.last_reviewed_at).toEqual(NOW);
  });

  it("new item, missed: box=1, next_review = now+1d, missed=1", () => {
    const result = nextState(null, "missed", NOW);
    expect(result.box).toBe(1);
    expect(result.next_review_at).toEqual(plusDays(NOW, 1));
    expect(result.total_reviews).toBe(1);
    expect(result.total_missed).toBe(1);
  });

  it("box 1 got_it -> box 2, +3d", () => {
    const prev: ReviewStateRow = {
      box: 1, total_reviews: 5, total_missed: 1,
      next_review_at: NOW, last_reviewed_at: NOW,
    };
    const result = nextState(prev, "got_it", NOW);
    expect(result.box).toBe(2);
    expect(result.next_review_at).toEqual(plusDays(NOW, 3));
    expect(result.total_reviews).toBe(6);
    expect(result.total_missed).toBe(1);
  });

  it("box 2 got_it -> box 3, +7d", () => {
    const prev: ReviewStateRow = { box: 2, total_reviews: 1, total_missed: 0, next_review_at: NOW, last_reviewed_at: NOW };
    expect(nextState(prev, "got_it", NOW).box).toBe(3);
    expect(nextState(prev, "got_it", NOW).next_review_at).toEqual(plusDays(NOW, 7));
  });

  it("box 3 got_it -> box 4, +14d", () => {
    const prev: ReviewStateRow = { box: 3, total_reviews: 1, total_missed: 0, next_review_at: NOW, last_reviewed_at: NOW };
    expect(nextState(prev, "got_it", NOW).box).toBe(4);
    expect(nextState(prev, "got_it", NOW).next_review_at).toEqual(plusDays(NOW, 14));
  });

  it("box 4 got_it -> box 5, +30d", () => {
    const prev: ReviewStateRow = { box: 4, total_reviews: 1, total_missed: 0, next_review_at: NOW, last_reviewed_at: NOW };
    expect(nextState(prev, "got_it", NOW).box).toBe(5);
    expect(nextState(prev, "got_it", NOW).next_review_at).toEqual(plusDays(NOW, 30));
  });

  it("box 5 got_it stays at box 5, +30d", () => {
    const prev: ReviewStateRow = { box: 5, total_reviews: 10, total_missed: 0, next_review_at: NOW, last_reviewed_at: NOW };
    expect(nextState(prev, "got_it", NOW).box).toBe(5);
    expect(nextState(prev, "got_it", NOW).next_review_at).toEqual(plusDays(NOW, 30));
  });

  it("missed from any box -> box 1, +1d, missed counter increments", () => {
    const prev: ReviewStateRow = { box: 4, total_reviews: 8, total_missed: 1, next_review_at: NOW, last_reviewed_at: NOW };
    const result = nextState(prev, "missed", NOW);
    expect(result.box).toBe(1);
    expect(result.next_review_at).toEqual(plusDays(NOW, 1));
    expect(result.total_reviews).toBe(9);
    expect(result.total_missed).toBe(2);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
npm --workspace server test
```

Expected: 8 failing tests in leitner.test.ts ("Cannot find module './leitner.js'").

- [ ] **Step 3: Implement `server/src/services/leitner.ts`**

```ts
export type ReviewStateRow = {
  box: number;
  next_review_at: Date;
  last_reviewed_at: Date | null;
  total_reviews: number;
  total_missed: number;
};

export type ReviewResult = "got_it" | "missed";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;  // 1-indexed via box-1

function plusDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * ONE_DAY_MS);
}

export function nextState(
  prev: ReviewStateRow | null,
  result: ReviewResult,
  now: Date,
): ReviewStateRow {
  const totalReviews = (prev?.total_reviews ?? 0) + 1;
  const totalMissed = (prev?.total_missed ?? 0) + (result === "missed" ? 1 : 0);

  if (prev === null) {
    // New item: first attempt is exposure. Always +1d, box stays 1.
    return {
      box: 1,
      next_review_at: plusDays(now, 1),
      last_reviewed_at: now,
      total_reviews: totalReviews,
      total_missed: totalMissed,
    };
  }

  if (result === "missed") {
    return {
      box: 1,
      next_review_at: plusDays(now, 1),
      last_reviewed_at: now,
      total_reviews: totalReviews,
      total_missed: totalMissed,
    };
  }

  const nextBox = Math.min(prev.box + 1, 5);
  const interval = INTERVAL_DAYS[nextBox - 1]!;
  return {
    box: nextBox,
    next_review_at: plusDays(now, interval),
    last_reviewed_at: now,
    total_reviews: totalReviews,
    total_missed: totalMissed,
  };
}
```

- [ ] **Step 4: Run, expect pass**

```bash
npm --workspace server test
```

Expected: all 8 leitner tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/leitner.ts server/src/services/leitner.test.ts
git commit -m "$(cat <<'EOF'
feat(server): Leitner state machine (pure, fully tested)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Queue endpoint (TDD with real Postgres)

**Files:**
- Create: `server/src/services/queue.ts`
- Create: `server/src/routes/queue.ts`
- Create: `server/src/routes/queue.test.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Write the failing test `server/src/routes/queue.test.ts`**

```ts
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { queueRouter } from "./queue.js";

const PASSCODE = "test-passcode";

const app = makeTestApp(PASSCODE, (a) => {
  a.use("/api/queue", queueRouter);
});

beforeAll(async () => {
  // schema already migrated by db:migrate before tests run
});

beforeEach(async () => {
  await resetDb();
});

async function insertItem(opts: { external_id: string; box?: number; nextReviewMinutesAgo?: number }) {
  const itemRes = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ('vocab', $1, $2, 'seed', $3) RETURNING id`,
    [
      JSON.stringify({ sentence_ruby: "x", target: "x", sentence_english: "x" }),
      JSON.stringify({ meaning: "y", reading: "y" }),
      opts.external_id,
    ],
  );
  const id = itemRes.rows[0].id as string;
  if (opts.box !== undefined) {
    const t = new Date(Date.now() - (opts.nextReviewMinutesAgo ?? 0) * 60_000);
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, total_reviews)
       VALUES ($1, $2, $3, 0)`,
      [id, opts.box, t.toISOString()],
    );
  }
  return id;
}

describe("GET /api/queue", () => {
  it("requires passcode", async () => {
    const res = await request(app).get("/api/queue");
    expect(res.status).toBe(401);
  });

  it("returns due items ordered by next_review_at ASC", async () => {
    const a = await insertItem({ external_id: "a", box: 1, nextReviewMinutesAgo: 30 });
    const b = await insertItem({ external_id: "b", box: 1, nextReviewMinutesAgo: 60 });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.due.map((i: { id: string }) => i.id)).toEqual([b, a]);
  });

  it("includes new items only when due.length < 10", async () => {
    // 5 due, 3 new → both populated
    for (let i = 0; i < 5; i++) await insertItem({ external_id: `due-${i}`, box: 1, nextReviewMinutesAgo: i + 1 });
    for (let i = 0; i < 3; i++) await insertItem({ external_id: `new-${i}` });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.due).toHaveLength(5);
    expect(res.body.new).toHaveLength(3);
  });

  it("does NOT include new items when due.length >= 10", async () => {
    for (let i = 0; i < 10; i++) await insertItem({ external_id: `due-${i}`, box: 1, nextReviewMinutesAgo: i + 1 });
    for (let i = 0; i < 3; i++) await insertItem({ external_id: `new-${i}` });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.body.due).toHaveLength(10);
    expect(res.body.new).toHaveLength(0);
  });

  it("caps new items at 10", async () => {
    for (let i = 0; i < 25; i++) await insertItem({ external_id: `new-${i}` });
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.body.due).toHaveLength(0);
    expect(res.body.new).toHaveLength(10);
  });

  it("excludes items not yet due", async () => {
    await insertItem({ external_id: "future", box: 2, nextReviewMinutesAgo: -60 }); // 60min in future
    const res = await request(app).get("/api/queue").set("X-Passcode", PASSCODE);
    expect(res.body.due).toHaveLength(0);
    expect(res.body.new).toHaveLength(0);
  });

  it("rejects non-vocab skill filter with 400", async () => {
    const res = await request(app).get("/api/queue?skill=grammar").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
npm --workspace server test
```

Expected: queue tests fail with "Cannot find module './queue.js'".

- [ ] **Step 3: Implement `server/src/services/queue.ts`**

```ts
import { pool } from "../db/pool.js";
import type { ItemRecord } from "@nihongo/shared";

const NEW_THRESHOLD = 10;
const NEW_CAP = 10;

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

export async function buildQueue(opts: { limit: number }): Promise<{ due: ItemRecord[]; new: ItemRecord[] }> {
  const dueRes = await pool.query<Row>(
    `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.tags, i.created_at
       FROM items i
       JOIN review_state rs ON rs.item_id = i.id
      WHERE i.skill = 'vocab'
        AND rs.next_review_at <= now()
      ORDER BY rs.next_review_at ASC
      LIMIT $1`,
    [opts.limit],
  );
  const due = dueRes.rows.map(toRecord);

  let neu: ItemRecord[] = [];
  if (due.length < NEW_THRESHOLD) {
    const newRes = await pool.query<Row>(
      `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.tags, i.created_at
         FROM items i
         LEFT JOIN review_state rs ON rs.item_id = i.id
        WHERE i.skill = 'vocab' AND rs.item_id IS NULL
        ORDER BY i.created_at ASC
        LIMIT $1`,
      [NEW_CAP],
    );
    neu = newRes.rows.map(toRecord);
  }

  return { due, new: neu };
}
```

- [ ] **Step 4: Implement `server/src/routes/queue.ts`**

```ts
import { Router } from "express";
import { buildQueue } from "../services/queue.js";

export const queueRouter = Router();

queueRouter.get("/", async (req, res) => {
  const skill = req.query.skill;
  if (skill !== undefined && skill !== "vocab") {
    res.status(400).json({ error: "only vocab is supported in phase 1", code: "SKILL_UNSUPPORTED" });
    return;
  }
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 500);
  const payload = await buildQueue({ limit });
  res.json(payload);
});
```

- [ ] **Step 5: Wire into `server/src/index.ts`** (replace `createApp` body to add the queue router)

Find the `createApp` function and add `app.use("/api/queue", queueRouter);` after the auth router. Add the import at the top:

```ts
import { queueRouter } from "./routes/queue.js";
```

Then inside `createApp`, after `app.use("/api/auth", authRouter);`:

```ts
  app.use("/api/queue", queueRouter);
```

- [ ] **Step 6: Run, expect pass**

```bash
npm --workspace server run db:migrate   # ensure schema is up-to-date
npm --workspace server test
```

Expected: 7 queue tests pass. Existing tests still green.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/queue.ts server/src/routes/queue.ts server/src/routes/queue.test.ts server/src/index.ts
git commit -m "$(cat <<'EOF'
feat(server): GET /api/queue with new-item interleaving threshold

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Sessions endpoints (TDD)

**Files:**
- Create: `server/src/routes/sessions.ts`
- Create: `server/src/routes/sessions.test.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Write failing test `server/src/routes/sessions.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { sessionsRouter } from "./sessions.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/sessions", sessionsRouter));

beforeEach(() => resetDb());

describe("POST /api/sessions", () => {
  it("creates a session and returns its id", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .set("X-Passcode", PASSCODE)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);

    const dbRes = await pool.query("SELECT id, ended_at FROM sessions WHERE id = $1", [res.body.id]);
    expect(dbRes.rows).toHaveLength(1);
    expect(dbRes.rows[0].ended_at).toBeNull();
  });

  it("accepts an optional skill_filter", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .set("X-Passcode", PASSCODE)
      .send({ skill_filter: "vocab" });
    expect(res.status).toBe(200);

    const dbRes = await pool.query("SELECT skill_filter FROM sessions WHERE id = $1", [res.body.id]);
    expect(dbRes.rows[0].skill_filter).toBe("vocab");
  });
});

describe("PATCH /api/sessions/:id", () => {
  it("sets ended_at", async () => {
    const start = await request(app).post("/api/sessions").set("X-Passcode", PASSCODE).send({});
    const id = start.body.id;
    const endedAt = new Date().toISOString();
    const res = await request(app)
      .patch(`/api/sessions/${id}`)
      .set("X-Passcode", PASSCODE)
      .send({ ended_at: endedAt });
    expect(res.status).toBe(200);

    const dbRes = await pool.query("SELECT ended_at FROM sessions WHERE id = $1", [id]);
    expect(new Date(dbRes.rows[0].ended_at).toISOString()).toBe(endedAt);
  });

  it("returns 404 for unknown session", async () => {
    const res = await request(app)
      .patch(`/api/sessions/00000000-0000-0000-0000-000000000000`)
      .set("X-Passcode", PASSCODE)
      .send({ ended_at: new Date().toISOString() });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
npm --workspace server test
```

Expected: 4 failures, "Cannot find module './sessions.js'".

- [ ] **Step 3: Implement `server/src/routes/sessions.ts`**

```ts
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";

export const sessionsRouter = Router();

const StartBody = z.object({ skill_filter: z.string().optional() });
const EndBody = z.object({ ended_at: z.string() });

sessionsRouter.post("/", async (req, res) => {
  const parsed = StartBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", code: "BAD_BODY" });
    return;
  }
  const { skill_filter } = parsed.data;
  const r = await pool.query(
    `INSERT INTO sessions (skill_filter) VALUES ($1) RETURNING id`,
    [skill_filter ?? null],
  );
  res.json({ id: r.rows[0].id });
});

sessionsRouter.patch("/:id", async (req, res) => {
  const parsed = EndBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", code: "BAD_BODY" });
    return;
  }
  const { id } = req.params;
  const r = await pool.query(
    `UPDATE sessions SET ended_at = $1 WHERE id = $2 RETURNING id`,
    [parsed.data.ended_at, id],
  );
  if (r.rowCount === 0) {
    res.status(404).json({ error: "session not found", code: "NOT_FOUND" });
    return;
  }
  res.json({ ok: true });
});
```

- [ ] **Step 4: Wire into `server/src/index.ts`** — add import and `app.use`:

```ts
import { sessionsRouter } from "./routes/sessions.js";
// ...
  app.use("/api/sessions", sessionsRouter);
```

- [ ] **Step 5: Run, expect pass**

```bash
npm --workspace server test
```

Expected: 4 sessions tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/sessions.ts server/src/routes/sessions.test.ts server/src/index.ts
git commit -m "$(cat <<'EOF'
feat(server): POST /api/sessions and PATCH /api/sessions/:id

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Reviews endpoint (TDD with idempotency)

**Files:**
- Create: `server/src/routes/reviews.ts`
- Create: `server/src/routes/reviews.test.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Write failing test `server/src/routes/reviews.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { reviewsRouter } from "./reviews.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/reviews", reviewsRouter));

async function insertItem(): Promise<string> {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ('vocab', $1, $2, 'seed', $3) RETURNING id`,
    [
      JSON.stringify({ sentence_ruby: "x", target: "x", sentence_english: "x" }),
      JSON.stringify({ meaning: "y", reading: "y" }),
      `e-${Math.random()}`,
    ],
  );
  return r.rows[0].id;
}

beforeEach(() => resetDb());

describe("POST /api/reviews", () => {
  it("creates state on first review and returns it", async () => {
    const itemId = await insertItem();
    const reviewedAt = new Date().toISOString();
    const res = await request(app)
      .post("/api/reviews")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: reviewedAt });
    expect(res.status).toBe(200);
    expect(res.body.box).toBe(1);
    expect(res.body.total_reviews).toBe(1);
    expect(res.body.total_missed).toBe(0);
    expect(typeof res.body.next_review_at).toBe("string");
  });

  it("increments box on subsequent got_it", async () => {
    const itemId = await insertItem();
    // Simulate an existing review_state with box=1, last reviewed yesterday
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, last_reviewed_at, total_reviews)
       VALUES ($1, 1, now() - interval '1 hour', now() - interval '1 day', 1)`,
      [itemId],
    );
    const res = await request(app)
      .post("/api/reviews")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: new Date().toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.box).toBe(2);
    expect(res.body.total_reviews).toBe(2);
  });

  it("missed resets box to 1 and increments total_missed", async () => {
    const itemId = await insertItem();
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, total_reviews, total_missed)
       VALUES ($1, 4, now() - interval '1 hour', 5, 1)`,
      [itemId],
    );
    const res = await request(app)
      .post("/api/reviews")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "missed", reviewed_at: new Date().toISOString() });
    expect(res.body.box).toBe(1);
    expect(res.body.total_missed).toBe(2);
  });

  it("is idempotent on duplicate (item_id, reviewed_at)", async () => {
    const itemId = await insertItem();
    const reviewedAt = new Date().toISOString();
    const first = await request(app).post("/api/reviews").set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: reviewedAt });
    const second = await request(app).post("/api/reviews").set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: reviewedAt });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    const r = await pool.query(`SELECT count(*)::int as c FROM reviews WHERE item_id = $1`, [itemId]);
    expect(r.rows[0].c).toBe(1);
    const s = await pool.query(`SELECT total_reviews FROM review_state WHERE item_id = $1`, [itemId]);
    expect(s.rows[0].total_reviews).toBe(1);
  });

  it("rejects unknown item with 404", async () => {
    const res = await request(app)
      .post("/api/reviews").set("X-Passcode", PASSCODE)
      .send({ item_id: "00000000-0000-0000-0000-000000000000", result: "got_it", reviewed_at: new Date().toISOString() });
    expect(res.status).toBe(404);
  });

  it("attaches session_id when provided", async () => {
    const itemId = await insertItem();
    const sess = await pool.query(`INSERT INTO sessions DEFAULT VALUES RETURNING id`);
    const sessionId = sess.rows[0].id;
    await request(app).post("/api/reviews").set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, result: "got_it", reviewed_at: new Date().toISOString(), session_id: sessionId });
    const r = await pool.query(`SELECT session_id FROM reviews WHERE item_id = $1`, [itemId]);
    expect(r.rows[0].session_id).toBe(sessionId);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
npm --workspace server test
```

Expected: 6 failures, "Cannot find module './reviews.js'".

- [ ] **Step 3: Implement `server/src/routes/reviews.ts`**

```ts
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { nextState, type ReviewStateRow } from "../services/leitner.js";

export const reviewsRouter = Router();

const Body = z.object({
  item_id: z.string().uuid(),
  result: z.enum(["got_it", "missed"]),
  reviewed_at: z.string(),
  session_id: z.string().uuid().optional(),
});

reviewsRouter.post("/", async (req, res) => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", code: "BAD_BODY" });
    return;
  }
  const { item_id, result, reviewed_at, session_id } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verify item exists
    const itemRes = await client.query(`SELECT id FROM items WHERE id = $1`, [item_id]);
    if (itemRes.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "item not found", code: "ITEM_NOT_FOUND" });
      return;
    }

    // Check idempotency: existing review at same timestamp?
    const dup = await client.query(
      `SELECT 1 FROM reviews WHERE item_id = $1 AND reviewed_at = $2`,
      [item_id, reviewed_at],
    );
    if ((dup.rowCount ?? 0) > 0) {
      const existing = await client.query(
        `SELECT box, next_review_at, total_reviews, total_missed FROM review_state WHERE item_id = $1`,
        [item_id],
      );
      await client.query("COMMIT");
      const row = existing.rows[0];
      res.json({
        box: row.box,
        next_review_at: row.next_review_at.toISOString(),
        total_reviews: row.total_reviews,
        total_missed: row.total_missed,
      });
      return;
    }

    // Load existing state, if any
    const stateRes = await client.query(
      `SELECT box, next_review_at, last_reviewed_at, total_reviews, total_missed
         FROM review_state WHERE item_id = $1`,
      [item_id],
    );
    const prev: ReviewStateRow | null = stateRes.rowCount === 0 ? null : {
      box: stateRes.rows[0].box,
      next_review_at: stateRes.rows[0].next_review_at,
      last_reviewed_at: stateRes.rows[0].last_reviewed_at,
      total_reviews: stateRes.rows[0].total_reviews,
      total_missed: stateRes.rows[0].total_missed,
    };

    const next = nextState(prev, result, new Date());

    // Upsert review_state
    await client.query(
      `INSERT INTO review_state (item_id, box, next_review_at, last_reviewed_at, total_reviews, total_missed)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (item_id) DO UPDATE
         SET box = EXCLUDED.box,
             next_review_at = EXCLUDED.next_review_at,
             last_reviewed_at = EXCLUDED.last_reviewed_at,
             total_reviews = EXCLUDED.total_reviews,
             total_missed = EXCLUDED.total_missed`,
      [item_id, next.box, next.next_review_at, next.last_reviewed_at, next.total_reviews, next.total_missed],
    );

    // Append-only review row
    await client.query(
      `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after, session_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [item_id, reviewed_at, result, prev?.box ?? 0, next.box, session_id ?? null],
    );

    await client.query("COMMIT");
    res.json({
      box: next.box,
      next_review_at: next.next_review_at.toISOString(),
      total_reviews: next.total_reviews,
      total_missed: next.total_missed,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});
```

- [ ] **Step 4: Wire into `server/src/index.ts`**:

```ts
import { reviewsRouter } from "./routes/reviews.js";
// ...
  app.use("/api/reviews", reviewsRouter);
```

- [ ] **Step 5: Run, expect pass**

```bash
npm --workspace server test
```

Expected: all 6 reviews tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/reviews.ts server/src/routes/reviews.test.ts server/src/index.ts
git commit -m "$(cat <<'EOF'
feat(server): POST /api/reviews with idempotency and Leitner promotion

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Streak endpoint (TDD with timezone)

**Files:**
- Create: `server/src/services/streak.ts`
- Create: `server/src/routes/stats.ts`
- Create: `server/src/routes/stats.test.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Write failing test `server/src/routes/stats.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { statsRouter } from "./stats.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/stats", statsRouter));

async function insertItemWithReview(reviewedAt: string): Promise<void> {
  const item = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ('vocab', $1, $2, 'seed', $3) RETURNING id`,
    [
      JSON.stringify({ sentence_ruby: "x", target: "x", sentence_english: "x" }),
      JSON.stringify({ meaning: "y", reading: "y" }),
      `e-${Math.random()}`,
    ],
  );
  await pool.query(
    `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after)
     VALUES ($1, $2, 'got_it', 1, 2)`,
    [item.rows[0].id, reviewedAt],
  );
}

beforeEach(() => resetDb());

describe("GET /api/stats/streak", () => {
  it("returns 0 when no reviews", async () => {
    const res = await request(app).get("/api/stats/streak?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ days: 0 });
  });

  it("returns 1 for a review today only", async () => {
    await insertItemWithReview(new Date().toISOString());
    const res = await request(app).get("/api/stats/streak?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body).toEqual({ days: 1 });
  });

  it("counts consecutive days back from today", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await insertItemWithReview(new Date(now).toISOString());
    await insertItemWithReview(new Date(now - day).toISOString());
    await insertItemWithReview(new Date(now - 2 * day).toISOString());
    const res = await request(app).get("/api/stats/streak?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body).toEqual({ days: 3 });
  });

  it("breaks the streak at a missed day", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await insertItemWithReview(new Date(now).toISOString());
    await insertItemWithReview(new Date(now - 2 * day).toISOString()); // skipped yesterday
    const res = await request(app).get("/api/stats/streak?tz=UTC").set("X-Passcode", PASSCODE);
    expect(res.body).toEqual({ days: 1 });
  });

  it("returns 400 for missing tz", async () => {
    const res = await request(app).get("/api/stats/streak").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
npm --workspace server test
```

Expected: 5 failures, "Cannot find module './stats.js'".

- [ ] **Step 3: Implement `server/src/services/streak.ts`**

```ts
import { pool } from "../db/pool.js";

// Returns the count of consecutive day-buckets ending "today" in the caller's
// timezone where at least one review was logged.
export async function computeStreak(tz: string): Promise<number> {
  const r = await pool.query<{ d: string }>(
    `SELECT DISTINCT to_char(date_trunc('day', reviewed_at AT TIME ZONE $1), 'YYYY-MM-DD') AS d
       FROM reviews
       ORDER BY d DESC`,
    [tz],
  );
  if (r.rowCount === 0) return 0;

  const todayStr = ymdInTz(new Date(), tz);
  let count = 0;
  let cursor = todayStr;
  for (const { d } of r.rows) {
    if (d === cursor) {
      count += 1;
      cursor = decYmd(cursor);
    } else if (count === 0 && d < todayStr) {
      return 0;
    } else {
      break;
    }
  }
  return count;
}

// Format a Date as YYYY-MM-DD as observed in the given IANA timezone.
function ymdInTz(d: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

function decYmd(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
```

- [ ] **Step 4: Implement `server/src/routes/stats.ts`**

```ts
import { Router } from "express";
import { computeStreak } from "../services/streak.js";

export const statsRouter = Router();

statsRouter.get("/streak", async (req, res) => {
  const tz = req.query.tz;
  if (typeof tz !== "string" || tz.length === 0) {
    res.status(400).json({ error: "tz query param required (IANA timezone)", code: "TZ_REQUIRED" });
    return;
  }
  // Validate the tz by attempting a no-op conversion. Throws on bad zone.
  try {
    new Date().toLocaleString("en-US", { timeZone: tz });
  } catch {
    res.status(400).json({ error: "invalid tz", code: "TZ_INVALID" });
    return;
  }
  const days = await computeStreak(tz);
  res.json({ days });
});
```

- [ ] **Step 5: Wire into `server/src/index.ts`**:

```ts
import { statsRouter } from "./routes/stats.js";
// ...
  app.use("/api/stats", statsRouter);
```

- [ ] **Step 6: Run, expect pass**

```bash
npm --workspace server test
```

Expected: 5 stats tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/streak.ts server/src/routes/stats.ts server/src/routes/stats.test.ts server/src/index.ts
git commit -m "$(cat <<'EOF'
feat(server): GET /api/stats/streak with timezone-aware grouping

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Seed workspace + XML parser (TDD)

**Files:**
- Modify: `package.json` (add `seed` to workspaces)
- Create: `seed/package.json`
- Create: `seed/tsconfig.json`
- Create: `seed/vitest.config.ts`
- Create: `seed/src/parse-xml.ts`
- Create: `seed/src/parse-xml.test.ts`
- Create: `seed/src/fixtures/deck.xml`

- [ ] **Step 1: Add `seed` to root workspaces** — edit `package.json`:

```json
  "workspaces": ["shared", "server", "client", "e2e", "seed"],
```

- [ ] **Step 2: Write `seed/package.json`**

```json
{
  "name": "@nihongo/seed",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "import": "tsx src/import.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@nihongo/shared": "*",
    "@anthropic-ai/sdk": "^0.39.0",
    "dotenv": "^16.4.5",
    "fast-xml-parser": "^4.5.0",
    "kuromoji": "^0.1.2",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/kuromoji": "^0.1.3",
    "@types/node": "^22.7.0",
    "@types/pg": "^8.11.10",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Write `seed/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Write `seed/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Write fixture `seed/src/fixtures/deck.xml`**

This is a minimal Migaku-style sample; real decks have many more `<card>` elements.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<deck name="Personal study">
  <fields>
    <field name="Japanese" />
    <field name="Meaning" />
  </fields>
  <cards>
    <card id="card-001">
      <japanese>食べる</japanese>
      <text name="Meaning">to eat</text>
    </card>
    <card id="card-002">
      <japanese>水</japanese>
      <text name="Meaning">water</text>
    </card>
    <card id="card-003">
      <japanese>美味しい</japanese>
      <text name="Meaning">delicious</text>
    </card>
  </cards>
</deck>
```

- [ ] **Step 6: Write the failing test `seed/src/parse-xml.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseDeckXml } from "./parse-xml.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("parseDeckXml", () => {
  it("extracts cards from the fixture deck", () => {
    const xml = readFileSync(path.join(__dirname, "fixtures/deck.xml"), "utf8");
    const cards = parseDeckXml(xml);
    expect(cards).toEqual([
      { external_id: "card-001", japanese: "食べる", english: "to eat" },
      { external_id: "card-002", japanese: "水", english: "water" },
      { external_id: "card-003", japanese: "美味しい", english: "delicious" },
    ]);
  });

  it("throws on malformed XML", () => {
    expect(() => parseDeckXml("<not valid")).toThrow();
  });

  it("skips cards missing required fields", () => {
    const xml = `<?xml version="1.0"?>
<deck>
  <cards>
    <card id="ok"><japanese>本</japanese><text name="Meaning">book</text></card>
    <card id="no-japanese"><text name="Meaning">missing</text></card>
    <card id="no-meaning"><japanese>無</japanese></card>
  </cards>
</deck>`;
    const cards = parseDeckXml(xml);
    expect(cards.map((c) => c.external_id)).toEqual(["ok"]);
  });
});
```

- [ ] **Step 7: Install workspace deps**

```bash
npm install
```

- [ ] **Step 8: Run, expect failure**

```bash
npm --workspace seed test
```

Expected: 3 failures, "Cannot find module './parse-xml.js'".

- [ ] **Step 9: Implement `seed/src/parse-xml.ts`**

```ts
import { XMLParser } from "fast-xml-parser";

export type CardInput = {
  external_id: string;
  japanese: string;
  english: string;
};

type RawText = string | { "#text"?: string; "@_name"?: string };

export function parseDeckXml(xml: string): CardInput[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => name === "card" || name === "text",
  });
  const doc = parser.parse(xml);
  const rawCards = doc?.deck?.cards?.card ?? [];
  if (!Array.isArray(rawCards)) {
    throw new Error("malformed deck: expected cards array");
  }
  const out: CardInput[] = [];
  for (const c of rawCards) {
    const id = c?.["@_id"];
    const japanese = c?.japanese;
    const texts: RawText[] = Array.isArray(c?.text) ? c.text : c?.text ? [c.text] : [];
    const meaning = texts.find((t) => typeof t === "object" && t["@_name"] === "Meaning");
    const english = typeof meaning === "object" ? meaning["#text"] : undefined;
    if (typeof id === "string" && typeof japanese === "string" && typeof english === "string") {
      out.push({ external_id: id, japanese: japanese.trim(), english: english.trim() });
    }
  }
  return out;
}
```

- [ ] **Step 10: Run, expect pass**

```bash
npm --workspace seed test
```

Expected: 3 parse-xml tests pass.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json seed/
git commit -m "$(cat <<'EOF'
feat(seed): workspace scaffold and XML deck parser

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Claude batch generator (TDD with mocked SDK)

**Files:**
- Create: `seed/src/generate.ts`
- Create: `seed/src/generate.test.ts`

- [ ] **Step 1: Write failing test `seed/src/generate.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { generateBatch, parseBatchResponse } from "./generate.js";
import type { CardInput } from "./parse-xml.js";

describe("parseBatchResponse", () => {
  it("returns sentences keyed by external_id", () => {
    const raw = JSON.stringify({
      sentences: [
        { external_id: "a", sentence_japanese: "私は本を読みます。", sentence_english: "I read a book." },
        { external_id: "b", sentence_japanese: "水を飲みます。", sentence_english: "I drink water." },
      ],
    });
    expect(parseBatchResponse(raw)).toEqual([
      { external_id: "a", sentence_japanese: "私は本を読みます。", sentence_english: "I read a book." },
      { external_id: "b", sentence_japanese: "水を飲みます。", sentence_english: "I drink water." },
    ]);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseBatchResponse("not json")).toThrow();
  });

  it("throws when entries are missing required fields", () => {
    const raw = JSON.stringify({ sentences: [{ external_id: "a" }] });
    expect(() => parseBatchResponse(raw)).toThrow();
  });
});

describe("generateBatch", () => {
  it("calls the client with a strict-JSON prompt and returns parsed sentences", async () => {
    const cards: CardInput[] = [
      { external_id: "a", japanese: "本", english: "book" },
      { external_id: "b", japanese: "水", english: "water" },
    ];
    const fakeText = JSON.stringify({
      sentences: [
        { external_id: "a", sentence_japanese: "私は本を読みます。", sentence_english: "I read a book." },
        { external_id: "b", sentence_japanese: "水を飲みます。", sentence_english: "I drink water." },
      ],
    });
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: fakeText }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const fakeClient = { messages: { create } };

    const result = await generateBatch(cards, { client: fakeClient as never });
    expect(result.sentences.map((s) => s.external_id)).toEqual(["a", "b"]);
    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0][0];
    expect(arg.model).toMatch(/sonnet/);
    expect(typeof arg.system).toBe("string");
    expect(arg.messages[0].content).toContain("本");
    expect(arg.messages[0].content).toContain("water");
  });

  it("retries once on parse failure", async () => {
    const cards: CardInput[] = [{ external_id: "a", japanese: "本", english: "book" }];
    const create = vi.fn()
      .mockResolvedValueOnce({ content: [{ type: "text", text: "garbage" }], usage: { input_tokens: 10, output_tokens: 5 } })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify({ sentences: [{ external_id: "a", sentence_japanese: "本。", sentence_english: "A book." }] }) }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    const fakeClient = { messages: { create } };
    const result = await generateBatch(cards, { client: fakeClient as never });
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.sentences).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
npm --workspace seed test
```

Expected: 5 failures, "Cannot find module './generate.js'".

- [ ] **Step 3: Implement `seed/src/generate.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { CardInput } from "./parse-xml.js";

export type SentenceOutput = {
  external_id: string;
  sentence_japanese: string;
  sentence_english: string;
};

export type BatchResult = {
  sentences: SentenceOutput[];
  cost_usd: number;
};

export const MODEL = "claude-sonnet-4-6";
const MAX_RETRIES = 2;

// Pricing per 1M tokens (sonnet 4.6, USD).
const INPUT_PER_MTOK = 3.0;
const OUTPUT_PER_MTOK = 15.0;

const SYSTEM_PROMPT = `You write a single natural everyday Japanese example sentence for each vocabulary word given.
The sentence MUST contain the target word verbatim. Keep it short (under 20 syllables) and use common modern Japanese.
Reply ONLY with valid JSON matching this exact schema:
{ "sentences": [ { "external_id": "<id>", "sentence_japanese": "<JA>", "sentence_english": "<EN>" } ] }
No commentary. No code fences.`;

function buildUserPrompt(cards: CardInput[]): string {
  return [
    "Generate one example sentence per word:",
    ...cards.map((c) => `- id=${c.external_id}: ${c.japanese} (${c.english})`),
  ].join("\n");
}

export function parseBatchResponse(raw: string): SentenceOutput[] {
  const parsed = JSON.parse(raw);
  const sentences = parsed?.sentences;
  if (!Array.isArray(sentences)) throw new Error("response missing 'sentences' array");
  for (const s of sentences) {
    if (typeof s?.external_id !== "string"
      || typeof s?.sentence_japanese !== "string"
      || typeof s?.sentence_english !== "string") {
      throw new Error("response entry missing required fields");
    }
  }
  return sentences as SentenceOutput[];
}

export async function generateBatch(
  cards: CardInput[],
  opts: { client?: Anthropic } = {},
): Promise<BatchResult> {
  const client = opts.client ?? new Anthropic();

  let lastErr: unknown;
  let totalInput = 0;
  let totalOutput = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(cards) }],
      });
      totalInput += resp.usage.input_tokens;
      totalOutput += resp.usage.output_tokens;
      const text = resp.content
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text)
        .join("");
      const sentences = parseBatchResponse(text);
      return {
        sentences,
        cost_usd: (totalInput / 1_000_000) * INPUT_PER_MTOK + (totalOutput / 1_000_000) * OUTPUT_PER_MTOK,
      };
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("generateBatch failed");
}
```

- [ ] **Step 4: Run, expect pass**

```bash
npm --workspace seed test
```

Expected: all parse + generate tests pass.

- [ ] **Step 5: Commit**

```bash
git add seed/src/generate.ts seed/src/generate.test.ts
git commit -m "$(cat <<'EOF'
feat(seed): batched Claude generator with retry and cost tracking

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Furigana via kuromoji

**Files:**
- Create: `seed/src/furigana.ts`

This task does not have a unit test — kuromoji loads a multi-megabyte dictionary asynchronously and the cleanest verification is a manual run on a sample. The downstream importer's manual smoke (Task 13) is the verification.

- [ ] **Step 1: Implement `seed/src/furigana.ts`**

```ts
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import kuromoji from "kuromoji";

type Tokenizer = {
  tokenize(text: string): Array<{
    surface_form: string;
    reading?: string;          // katakana
    pos?: string;
  }>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DICT_DIR = path.resolve(__dirname, "../../node_modules/kuromoji/dict");

let cached: Tokenizer | null = null;

export async function getTokenizer(): Promise<Tokenizer> {
  if (cached) return cached;
  const build = promisify((cb: (err: Error | null, t: Tokenizer | undefined) => void) => {
    kuromoji.builder({ dicPath: DICT_DIR }).build(cb);
  });
  const t = await build();
  if (!t) throw new Error("kuromoji failed to build tokenizer");
  cached = t;
  return t;
}

const KATAKANA_TO_HIRAGANA = (s: string): string =>
  s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

const HAS_KANJI = /[一-龯]/;

// Wraps each kanji-containing surface form in <ruby><rt>kana</rt></ruby>.
export async function toRubyHtml(text: string): Promise<string> {
  const tok = await getTokenizer();
  const tokens = tok.tokenize(text);
  let out = "";
  for (const t of tokens) {
    if (HAS_KANJI.test(t.surface_form) && t.reading) {
      const hira = KATAKANA_TO_HIRAGANA(t.reading);
      out += `<ruby>${escapeHtml(t.surface_form)}<rt>${escapeHtml(hira)}</rt></ruby>`;
    } else {
      out += escapeHtml(t.surface_form);
    }
  }
  return out;
}

// Returns the hiragana reading for a single word. Used to populate items.answer.reading.
export async function readingFor(word: string): Promise<string> {
  const tok = await getTokenizer();
  const tokens = tok.tokenize(word);
  return tokens.map((t) => t.reading ? KATAKANA_TO_HIRAGANA(t.reading) : t.surface_form).join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

- [ ] **Step 2: Type-check**

```bash
cd seed && npx tsc --noEmit && cd ..
```

Expected: exit 0. (Functional verification happens in Task 12 when the importer runs against the fixture deck — kuromoji's dictionary load takes several seconds, so a unit test would slow the suite down. Cost/benefit favors validating it via the Task 12 manual smoke.)

- [ ] **Step 3: Commit**

```bash
git add seed/src/furigana.ts
git commit -m "$(cat <<'EOF'
feat(seed): kuromoji-based furigana renderer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Importer orchestrator + DB insert

**Files:**
- Create: `seed/src/insert.ts`
- Create: `seed/src/import.ts`

- [ ] **Step 1: Implement `seed/src/insert.ts`**

```ts
import type { Pool } from "pg";

export type InsertItem = {
  external_id: string;
  prompt: { sentence_ruby: string; target: string; sentence_english: string };
  answer: { meaning: string; reading: string };
};

export async function insertSeedItems(pool: Pool, items: InsertItem[]): Promise<{ inserted: number; skipped: number }> {
  if (items.length === 0) return { inserted: 0, skipped: 0 };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0;
    for (const it of items) {
      const r = await client.query(
        `INSERT INTO items (skill, prompt, answer, source, external_id)
         VALUES ('vocab', $1, $2, 'seed', $3)
         ON CONFLICT (source, external_id) DO NOTHING`,
        [JSON.stringify(it.prompt), JSON.stringify(it.answer), it.external_id],
      );
      if ((r.rowCount ?? 0) > 0) inserted += 1;
    }
    await client.query("COMMIT");
    return { inserted, skipped: items.length - inserted };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: Implement `seed/src/import.ts`** (the CLI orchestrator)

```ts
import "dotenv/config";
import { readFileSync } from "node:fs";
import pg from "pg";
import { parseDeckXml, type CardInput } from "./parse-xml.js";
import { generateBatch } from "./generate.js";
import { toRubyHtml, readingFor } from "./furigana.js";
import { insertSeedItems, type InsertItem } from "./insert.js";

const BATCH_SIZE = 20;

async function main() {
  const xmlPath = process.argv[2];
  if (!xmlPath) {
    console.error("usage: tsx src/import.ts <path-to-deck.xml>");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");

  const xml = readFileSync(xmlPath, "utf8");
  const allCards = parseDeckXml(xml);
  console.log(`parsed ${allCards.length} cards from ${xmlPath}`);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // Skip cards already seeded.
  const existingRes = await pool.query<{ external_id: string }>(
    `SELECT external_id FROM items WHERE source='seed' AND external_id = ANY($1::text[])`,
    [allCards.map((c) => c.external_id)],
  );
  const existing = new Set(existingRes.rows.map((r) => r.external_id));
  const cards = allCards.filter((c) => !existing.has(c.external_id));
  console.log(`${existing.size} already seeded; ${cards.length} to import`);

  let totalInserted = 0;
  let totalSkipped = existing.size;
  let totalFailedBatches = 0;
  let totalCost = 0;

  for (let i = 0; i < cards.length; i += BATCH_SIZE) {
    const batch = cards.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(cards.length / BATCH_SIZE);
    console.log(`batch ${batchNum}/${totalBatches} (${batch.length} cards)…`);
    try {
      const result = await generateBatch(batch);
      totalCost += result.cost_usd;

      const items: InsertItem[] = [];
      const byId = new Map(result.sentences.map((s) => [s.external_id, s]));
      for (const card of batch) {
        const sent = byId.get(card.external_id);
        if (!sent) {
          console.warn(`  missing sentence for ${card.external_id}, skipping`);
          continue;
        }
        const sentence_ruby = await toRubyHtml(sent.sentence_japanese);
        const reading = await readingFor(card.japanese);
        items.push({
          external_id: card.external_id,
          prompt: {
            sentence_ruby,
            target: card.japanese,
            sentence_english: sent.sentence_english,
          },
          answer: {
            meaning: card.english,
            reading,
          },
        });
      }
      const ins = await insertSeedItems(pool, items);
      totalInserted += ins.inserted;
      totalSkipped += ins.skipped;
      console.log(`  inserted=${ins.inserted} skipped=${ins.skipped} cost_so_far=$${totalCost.toFixed(4)}`);
    } catch (err) {
      totalFailedBatches += 1;
      console.error(`  batch failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("---");
  console.log(`done. inserted=${totalInserted} skipped=${totalSkipped} failed_batches=${totalFailedBatches} cost=$${totalCost.toFixed(4)}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Type-check**

```bash
npx --workspace seed tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Manual smoke against a minimal input** (3 cards from the test fixture)

Set `ANTHROPIC_API_KEY` and run:

```bash
docker compose up -d postgres
npm --workspace server run db:migrate
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo \
  npm --workspace seed run import -- seed/src/fixtures/deck.xml
```

Expected output:
```
parsed 3 cards from seed/src/fixtures/deck.xml
0 already seeded; 3 to import
batch 1/1 (3 cards)…
  inserted=3 skipped=0 cost_so_far=$0.00xx
---
done. inserted=3 skipped=0 failed_batches=0 cost=$0.00xx
```

Verify in Postgres:
```bash
docker compose exec -T postgres psql -U nihongo -d nihongo \
  -c "SELECT prompt->>'target' AS target, prompt->>'sentence_ruby' AS ruby FROM items WHERE source='seed' ORDER BY external_id;"
```

Expected: 3 rows showing the targets `食べる`, `水`, `美味しい` and ruby HTML for each.

Re-run the importer to confirm idempotency:

```bash
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo \
  npm --workspace seed run import -- seed/src/fixtures/deck.xml
```

Expected: `3 already seeded; 0 to import`. Total cost $0.

- [ ] **Step 5: Commit**

```bash
git add seed/src/insert.ts seed/src/import.ts
git commit -m "$(cat <<'EOF'
feat(seed): orchestrator that imports XML decks into items table

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Client API extensions

**Files:**
- Create: `client/src/api-hooks.ts`

The existing `client/src/api.ts` provides the generic `api()` fetch wrapper with passcode injection. This task adds typed wrappers for the Phase 1 endpoints.

- [ ] **Step 1: Write `client/src/api-hooks.ts`**

```ts
import { api } from "./api";
import type {
  QueueResponse,
  StartSessionResponse,
  ReviewStateResponse,
  StreakResponse,
  ReviewResult,
} from "@nihongo/shared";

export function fetchQueue(): Promise<QueueResponse> {
  return api<QueueResponse>("/api/queue");
}

export function fetchStreak(): Promise<StreakResponse> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return api<StreakResponse>(`/api/stats/streak?tz=${encodeURIComponent(tz)}`);
}

export function startSession(): Promise<StartSessionResponse> {
  return api<StartSessionResponse>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ skill_filter: "vocab" }),
  });
}

export function endSession(id: string): Promise<{ ok: true }> {
  return api(`/api/sessions/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ ended_at: new Date().toISOString() }),
  });
}

export function submitReview(input: {
  item_id: string;
  result: ReviewResult;
  reviewed_at: string;
  session_id?: string;
}): Promise<ReviewStateResponse> {
  return api<ReviewStateResponse>("/api/reviews", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
```

- [ ] **Step 2: Type-check the client**

```bash
npm --workspace client run build
```

Expected: build succeeds (no React import error since this file is pure TS).

- [ ] **Step 3: Commit**

```bash
git add client/src/api-hooks.ts
git commit -m "$(cat <<'EOF'
feat(client): typed API hooks for queue, sessions, reviews, streak

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: RubyText component

**Files:**
- Create: `client/src/components/RubyText.tsx`

The sanitizer is already unit-tested in `shared/src/sanitize.test.ts`. This component is a thin wrapper.

- [ ] **Step 1: Write `client/src/components/RubyText.tsx`**

```tsx
import { sanitizeRuby } from "@nihongo/shared";

type Props = {
  html: string;
  className?: string;
};

export function RubyText({ html, className }: Props) {
  const safe = sanitizeRuby(html);
  return <span className={className} dangerouslySetInnerHTML={{ __html: safe }} />;
}
```

(`sanitizeRuby` is re-exported from `shared/src/types.ts` in Task 2, so no `exports` field changes are needed here.)

- [ ] **Step 2: Type-check**

```bash
npm --workspace client run build
```

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/RubyText.tsx
git commit -m "$(cat <<'EOF'
feat(client): RubyText component using shared sanitizer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Visual treatment via the frontend-design skill

The spec mandates: *"At the start of client implementation, invoke the `frontend-design` skill to produce a distinctive, production-grade interface."* Phase 0 established design tokens; this task extends them with concrete visual treatment for the Today screen, FlipCard component, and bottom tab nav.

**Files (output of the skill):**
- Create: `client/src/styles/cards.css` — FlipCard, Today hero, tab bar component styles using existing tokens
- Modify: `client/src/main.tsx` — import the new stylesheet

- [ ] **Step 1: Invoke the skill**

Use the Skill tool: `frontend-design`. Brief it with:

> "Extend the v0 design system in `client/src/styles/tokens.css` and `base.css` with component styles for three things in this iPhone-first vocab review PWA:
>
> 1. **FlipCard** — a card that shows a Japanese sentence (with `<ruby>` furigana) on the front and the answer (target word, kana reading, English meaning) on the back. Tap to flip. After flipping, two thumb-zone buttons: Missed (left, secondary/danger) and Got it (right, primary/success). Animation: smooth flip transform.
>
> 2. **Today screen hero** — large due-count number, 'cards due' label, streak below, big primary 'Start review' button anchored low for thumb reach.
>
> 3. **Bottom tab bar** — 4 tabs (Today / Practice / Browse / Stats), active state, iOS safe-area aware. Two of the tabs render 'Coming soon' placeholder content (out of scope for visual styling beyond the placeholder feel).
>
> Constraints: dark mode default, light mode supported via existing tokens. Furigana legibility: ~55% of base size, comfortable line-height, high contrast. No new dependencies. Output a single file `client/src/styles/cards.css` consuming existing CSS custom properties from tokens.css. Components in JSX will use class names from this file — list them clearly in a comment header."

- [ ] **Step 2: Verify the deliverable exists**

```bash
ls client/src/styles/cards.css
```

Expected: file present.

- [ ] **Step 3: Wire it in** — edit `client/src/main.tsx` to import `./styles/cards.css` after `./styles/base.css`:

```tsx
import "./styles/base.css";
import "./styles/cards.css";
```

- [ ] **Step 4: Smoke build**

```bash
npm --workspace client run build
```

Expected: success.

- [ ] **Step 5: Commit**

```bash
git add client/src/styles/cards.css client/src/main.tsx
git commit -m "$(cat <<'EOF'
feat(client): visual treatment for FlipCard, Today hero, and tab bar

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: FlipCard component

**Files:**
- Create: `client/src/components/FlipCard.tsx`

- [ ] **Step 1: Write `client/src/components/FlipCard.tsx`**

```tsx
import { useState } from "react";
import { RubyText } from "./RubyText";
import type { ItemRecord } from "@nihongo/shared";

type Props = {
  item: ItemRecord;
  onAnswer: (result: "got_it" | "missed") => void;
};

export function FlipCard({ item, onAnswer }: Props) {
  const [revealed, setRevealed] = useState(false);

  const { sentence_ruby, sentence_english, target } = item.prompt;
  const { meaning, reading } = item.answer;

  return (
    <article className={`flipcard ${revealed ? "is-revealed" : ""}`}>
      <div className="flipcard__face flipcard__face--prompt">
        <p className="flipcard__sentence">
          <RubyText html={sentence_ruby} />
        </p>
        {!revealed && (
          <button
            type="button"
            className="flipcard__reveal"
            onClick={() => setRevealed(true)}
          >
            Tap to reveal
          </button>
        )}
      </div>

      {revealed && (
        <div className="flipcard__face flipcard__face--answer">
          <p className="flipcard__sentence-secondary">
            <RubyText html={sentence_ruby} />
          </p>
          <div className="flipcard__answer-block">
            <p className="flipcard__target">
              <ruby>
                {target}
                <rt>{reading}</rt>
              </ruby>
            </p>
            <p className="flipcard__meaning">{meaning}</p>
            <p className="flipcard__english">{sentence_english}</p>
          </div>
          <div className="flipcard__actions">
            <button
              type="button"
              className="flipcard__btn flipcard__btn--missed"
              onClick={() => onAnswer("missed")}
            >
              Missed
            </button>
            <button
              type="button"
              className="flipcard__btn flipcard__btn--got"
              onClick={() => onAnswer("got_it")}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npm --workspace client run build
```

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/FlipCard.tsx
git commit -m "$(cat <<'EOF'
feat(client): FlipCard component with prompt/answer faces

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Bottom tab nav + screens (browse/stats stubs)

**Files:**
- Create: `client/src/components/BottomTabs.tsx`
- Create: `client/src/screens/BrowseScreen.tsx`
- Create: `client/src/screens/StatsScreen.tsx`

- [ ] **Step 1: Write `client/src/components/BottomTabs.tsx`**

```tsx
export type Tab = "today" | "practice" | "browse" | "stats";

type Props = {
  active: Tab;
  onChange: (tab: Tab) => void;
};

const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "practice", label: "Practice" },
  { id: "browse", label: "Browse" },
  { id: "stats", label: "Stats" },
];

export function BottomTabs({ active, onChange }: Props) {
  return (
    <nav className="tabs" aria-label="Primary">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tabs__btn ${active === t.id ? "is-active" : ""}`}
          aria-current={active === t.id ? "page" : undefined}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Write `client/src/screens/BrowseScreen.tsx`**

```tsx
export function BrowseScreen() {
  return (
    <main className="screen screen--placeholder">
      <h1>Browse</h1>
      <p className="muted">Coming in a later phase.</p>
    </main>
  );
}
```

- [ ] **Step 3: Write `client/src/screens/StatsScreen.tsx`**

```tsx
export function StatsScreen() {
  return (
    <main className="screen screen--placeholder">
      <h1>Stats</h1>
      <p className="muted">Coming in a later phase.</p>
    </main>
  );
}
```

- [ ] **Step 4: Type-check**

```bash
npm --workspace client run build
```

Expected: success.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/BottomTabs.tsx client/src/screens/BrowseScreen.tsx client/src/screens/StatsScreen.tsx
git commit -m "$(cat <<'EOF'
feat(client): bottom tab nav with Browse/Stats placeholders

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Today screen with real data

**Files:**
- Modify: `client/src/screens/TodayScreen.tsx` (replace existing placeholder)

- [ ] **Step 1: Replace `client/src/screens/TodayScreen.tsx`**

```tsx
import { useEffect, useState } from "react";
import { auth } from "../auth";
import { fetchQueue, fetchStreak } from "../api-hooks";

type Props = {
  onSignOut: () => void;
  onStartReview: () => void;
};

type State = {
  loading: boolean;
  due: number;
  newCount: number;
  streak: number;
  error: string | null;
};

export function TodayScreen({ onSignOut, onStartReview }: Props) {
  const [s, setS] = useState<State>({ loading: true, due: 0, newCount: 0, streak: 0, error: null });

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchQueue(), fetchStreak()])
      .then(([queue, streak]) => {
        if (cancelled) return;
        setS({
          loading: false,
          due: queue.due.length,
          newCount: queue.new.length,
          streak: streak.days,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setS((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : "load failed" }));
      });
    return () => { cancelled = true; };
  }, []);

  function signOut() {
    auth.clear();
    onSignOut();
  }

  const totalReady = s.due + s.newCount;

  return (
    <main className="screen">
      <header className="topbar">
        <h1>Today</h1>
        <button onClick={signOut} className="link">Sign out</button>
      </header>

      {s.loading ? (
        <section className="hero"><p>Loading…</p></section>
      ) : s.error ? (
        <section className="hero"><p role="alert">Couldn't load: {s.error}</p></section>
      ) : (
        <>
          <section className="hero">
            <p className="big-number">{totalReady}</p>
            <p>cards ready</p>
            <p className="muted">
              {s.due} due · {s.newCount} new · {s.streak}-day streak
            </p>
          </section>

          {totalReady > 0 ? (
            <button type="button" className="cta" onClick={onStartReview}>
              Start review
            </button>
          ) : (
            <p className="muted center">All caught up — come back tomorrow.</p>
          )}
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npm --workspace client run build
```

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add client/src/screens/TodayScreen.tsx
git commit -m "$(cat <<'EOF'
feat(client): Today screen wired to /api/queue and /api/stats/streak

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Practice screen + session loop

**Files:**
- Create: `client/src/screens/PracticeScreen.tsx`

- [ ] **Step 1: Write `client/src/screens/PracticeScreen.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import type { ItemRecord, ReviewResult } from "@nihongo/shared";
import { fetchQueue, startSession, endSession, submitReview } from "../api-hooks";
import { FlipCard } from "../components/FlipCard";

type Phase = "loading" | "empty" | "reviewing" | "summary" | "error";

type Props = {
  onDone: () => void;
};

export function PracticeScreen({ onDone }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [index, setIndex] = useState(0);
  const [counts, setCounts] = useState({ got: 0, missed: 0 });
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ id }, queue] = await Promise.all([startSession(), fetchQueue()]);
        if (cancelled) return;
        sessionIdRef.current = id;
        const all = [...queue.due, ...queue.new];
        setItems(all);
        setPhase(all.length === 0 ? "empty" : "reviewing");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "load failed");
        setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function handleAnswer(result: ReviewResult) {
    const item = items[index];
    if (!item) return;
    setCounts((c) => result === "got_it" ? { ...c, got: c.got + 1 } : { ...c, missed: c.missed + 1 });

    // Optimistically advance.
    const reviewedAt = new Date().toISOString();
    void retryingSubmit({
      item_id: item.id,
      result,
      reviewed_at: reviewedAt,
      session_id: sessionIdRef.current ?? undefined,
    });

    if (index + 1 >= items.length) {
      void finishSession();
    } else {
      setIndex(index + 1);
    }
  }

  async function finishSession() {
    if (sessionIdRef.current) {
      try { await endSession(sessionIdRef.current); } catch { /* tolerate failure; UI moves on */ }
    }
    setPhase("summary");
  }

  if (phase === "loading") return <main className="screen screen--centered">Loading…</main>;
  if (phase === "error") return <main className="screen screen--centered"><p role="alert">{error}</p></main>;
  if (phase === "empty") {
    return (
      <main className="screen screen--centered">
        <p>Nothing due right now.</p>
        <button type="button" className="cta" onClick={onDone}>Back to Today</button>
      </main>
    );
  }
  if (phase === "summary") {
    return (
      <main className="screen screen--centered">
        <h1>Done</h1>
        <p>{counts.got} got it · {counts.missed} missed</p>
        <button type="button" className="cta" onClick={onDone}>Back to Today</button>
      </main>
    );
  }
  const current = items[index];
  if (!current) return <main className="screen">No item</main>;
  return (
    <main className="screen screen--practice">
      <p className="practice__progress">{index + 1} / {items.length}</p>
      <FlipCard key={current.id} item={current} onAnswer={handleAnswer} />
    </main>
  );
}

async function retryingSubmit(input: Parameters<typeof submitReview>[0]): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await submitReview(input);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  console.error("submitReview failed after 3 attempts", lastErr);
}
```

- [ ] **Step 2: Wire screens into `client/src/App.tsx`** — replace the file:

```tsx
import { useEffect, useState } from "react";
import { auth } from "./auth";
import { api } from "./api";
import { PasscodeScreen } from "./screens/PasscodeScreen";
import { TodayScreen } from "./screens/TodayScreen";
import { PracticeScreen } from "./screens/PracticeScreen";
import { BrowseScreen } from "./screens/BrowseScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { BottomTabs, type Tab } from "./components/BottomTabs";

type AuthState = "checking" | "needs-auth" | "authed";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [tab, setTab] = useState<Tab>("today");

  useEffect(() => {
    if (!auth.get()) { setAuthState("needs-auth"); return; }
    api("/api/auth/check", { method: "POST", body: "{}" })
      .then(() => setAuthState("authed"))
      .catch(() => setAuthState("needs-auth"));
  }, []);

  if (authState === "checking") return <main className="screen screen--centered">Loading…</main>;
  if (authState === "needs-auth") return <PasscodeScreen onAuthed={() => setAuthState("authed")} />;

  let active;
  if (tab === "today")    active = <TodayScreen onSignOut={() => setAuthState("needs-auth")} onStartReview={() => setTab("practice")} />;
  else if (tab === "practice") active = <PracticeScreen onDone={() => setTab("today")} />;
  else if (tab === "browse")   active = <BrowseScreen />;
  else                        active = <StatsScreen />;

  return (
    <div className="app">
      {active}
      <BottomTabs active={tab} onChange={setTab} />
    </div>
  );
}
```

- [ ] **Step 3: Smoke-build the client**

```bash
npm --workspace client run build
```

Expected: success.

- [ ] **Step 4: Manual smoke against local stack**

In one terminal:
```bash
PASSCODE=test DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo npm --workspace server run dev
```

In another:
```bash
npm --workspace client run dev
```

Open http://localhost:5173 → enter `test` → confirm Today screen shows the 3 fixture items as "3 cards ready" (they were inserted in Task 12). Tap Start review → flip a card → tap "Got it" → next card → finish → summary → Back to Today → confirm "ready" count decreased.

- [ ] **Step 5: Commit**

```bash
git add client/src/screens/PracticeScreen.tsx client/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(client): Practice screen with session loop and optimistic submits

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: Extend Playwright smoke

**Files:**
- Create: `e2e/tests/fixtures/seed-test-items.sql`
- Modify: `e2e/tests/smoke.spec.ts`
- Modify: `e2e/playwright.config.ts` (add a globalSetup that loads the fixture)
- Create: `e2e/tests/global-setup.ts`

The Phase 0 smoke covered passcode → Today placeholder. Phase 1 needs to assert the review flow against a deterministic fixture, since live-seeded data varies. We load 3 hand-crafted items via SQL before the test.

- [ ] **Step 1: Create `e2e/tests/fixtures/seed-test-items.sql`**

```sql
TRUNCATE TABLE reviews, review_state, items, sessions RESTART IDENTITY CASCADE;

INSERT INTO items (skill, prompt, answer, source, external_id) VALUES
('vocab',
 '{"sentence_ruby":"<ruby>水<rt>みず</rt></ruby>を<ruby>飲<rt>の</rt></ruby>みます。","target":"水","sentence_english":"I drink water."}',
 '{"meaning":"water","reading":"みず"}',
 'seed', 'e2e-001'),
('vocab',
 '{"sentence_ruby":"<ruby>本<rt>ほん</rt></ruby>を<ruby>読<rt>よ</rt></ruby>みます。","target":"本","sentence_english":"I read a book."}',
 '{"meaning":"book","reading":"ほん"}',
 'seed', 'e2e-002'),
('vocab',
 '{"sentence_ruby":"<ruby>食<rt>た</rt></ruby>べます。","target":"食べる","sentence_english":"I eat."}',
 '{"meaning":"to eat","reading":"たべる"}',
 'seed', 'e2e-003');
```

- [ ] **Step 2: Create `e2e/tests/global-setup.ts`**

```ts
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL required for e2e setup");
  const fixture = path.join(__dirname, "fixtures/seed-test-items.sql");
  execSync(`psql "${dbUrl}" -f "${fixture}"`, { stdio: "inherit" });
}
```

- [ ] **Step 3: Update `e2e/playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "iphone-14", use: { ...devices["iPhone 14"] } },
  ],
});
```

- [ ] **Step 4: Replace `e2e/tests/smoke.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

const PASSCODE = process.env.E2E_PASSCODE ?? "test";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Passcode").fill(PASSCODE);
  await page.getByRole("button", { name: /enter/i }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

test("passcode → Today shows fixture cards ready", async ({ page }) => {
  await login(page);
  await expect(page.getByText("cards ready")).toBeVisible();
  // 3 items in fixture; new-item rule means all 3 surface on day one
  await expect(page.locator(".big-number")).toContainText("3");
});

test("wrong passcode shows an error", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Passcode").fill("definitely-wrong");
  await page.getByRole("button", { name: /enter/i }).click();
  await expect(page.getByRole("alert")).toHaveText(/wrong passcode/i);
});

test("review one card and queue advances", async ({ page }) => {
  await login(page);
  const startBtn = page.getByRole("button", { name: /start review/i });
  await startBtn.click();
  // Flip + answer one card
  await page.getByRole("button", { name: /tap to reveal/i }).click();
  await page.getByRole("button", { name: /got it/i }).click();
  // Either the next card shows or summary screen.
  // After 3 answers we land on the summary; here just check the progress moved or summary appeared.
  await expect(page.locator(".practice__progress, h1:has-text('Done')")).toBeVisible();
});
```

- [ ] **Step 5: Run E2E locally**

In two terminals: server + client running with `PASSCODE=test`. Then:

```bash
DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo \
E2E_PASSCODE=test \
  npm --workspace e2e test
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add e2e/
git commit -m "$(cat <<'EOF'
test(e2e): smoke covers vocab review flow with deterministic fixture

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: Run real seed import + manual smoke

This is a one-time owner action, not a CI step. The fixture seed data from earlier tasks is replaced with the real ~300-card deck.

- [ ] **Step 1: Wipe the local fixture data first** (so the real import runs from a clean slate)

```bash
docker compose exec -T postgres psql -U nihongo -d nihongo -c "TRUNCATE TABLE reviews, review_state, items, sessions RESTART IDENTITY CASCADE;"
```

- [ ] **Step 2: Run the importer against the real XML**

```bash
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo \
  npm --workspace seed run import -- "/Users/michaelgalloway/Library/Mobile Documents/com~apple~CloudDocs/Personal study.xml"
```

Expected: ~15 batches, all succeed, total cost under $1, `inserted=N` where N is the deck size.

- [ ] **Step 3: Manual local smoke**

Run server + client locally, log in, confirm Today shows N "cards ready". Practice through 3-5 cards, mark mixed got/missed, finish session, confirm count decreased and a streak of 1.

- [ ] **Step 4: No commit** — this task seeds the local DB only. The real production import happens in Task 22.

---

### Task 22: Deploy and prod smoke

- [ ] **Step 1: Push the branch and trigger CI** (the PR is opened in Task 23; this is a pre-PR sanity push so CI catches anything before review)

```bash
git push -u origin feat/phase-1-vocab-loop
```

Wait for the GitHub Actions run. Expected: green test + e2e jobs.

- [ ] **Step 2: Deploy from the branch**

The existing `scripts/deploy.sh` deploys the current branch. Run it:

```bash
bash scripts/deploy.sh
```

Expected: deploy completes. `curl -fsS https://spruce-cedar.exe.xyz/healthz` returns `{"ok":true}`. Migration `1746460800000_phase1_tables` is logged as applied.

- [ ] **Step 3: Run the seed importer against production**

The seed script connects to whatever `DATABASE_URL` points at. Use the production credentials from `~/.claude/projects/-Users-michaelgalloway-dev-nihongo-practice/memory/prod-config.md` (the `.env` on the VM has the right URL — copy it locally for this run, or SSH to the VM and run from there).

Recommended: SSH to the VM and run from there to avoid round-tripping the connection over the public internet.

```bash
ssh exedev@spruce-cedar.exe.xyz '
  cd /home/exedev/nihongo-practice && \
  ANTHROPIC_API_KEY="$(grep ^ANTHROPIC_API_KEY .env | cut -d= -f2)" \
  DATABASE_URL="$(grep ^DATABASE_URL .env | cut -d= -f2)" \
  npm --workspace seed run import -- /home/exedev/Personal\ study.xml
'
```

(Copy the XML to the VM first via `scp` if it's not already there.)

Expected: ~$0.30–$1.00 total cost; inserted count matches the deck size.

- [ ] **Step 4: Manual smoke against production**

Open `https://spruce-cedar.exe.xyz` on iPhone. Enter the production passcode. Confirm Today shows the imported deck count. Run a session, answer 3-5 cards, finish. Confirm count decreased and streak now reads 1.

---

### Task 23: Open the PR

- [ ] **Step 1: Create the PR**

```bash
gh pr create --title "feat: Phase 1 — vocab review loop end-to-end" --body "$(cat <<'EOF'
## Summary
Implements Phase 1 of the spec: the daily vocab review loop, end-to-end.
The owner can open the app on iPhone, see today's due count, drill cards
with example sentences and furigana, and have progress saved server-side.

## What's in
- DB: items, review_state, reviews, sessions tables
- Server: Leitner state machine, queue/sessions/reviews/streak endpoints, with idempotency
- Seed importer: XML parsing, batched Claude generation, kuromoji furigana, idempotent insert
- Client: Today + Practice screens, FlipCard component, RubyText sanitizer, bottom tab nav (Browse/Stats stubs)
- E2E: extended smoke covering the full review flow

## What's deliberately not in
The other 4 skills (grammar/reading/conjugation/particle), AI top-up endpoint,
Browse list, full Stats screen, Settings, IndexedDB offline queue.
Each becomes its own small phase.

## Test plan
- [ ] `npm test` passes locally
- [ ] `npm --workspace seed test` passes
- [ ] CI is green (server tests + Playwright)
- [ ] Real deck imports successfully against production with cost under $1
- [ ] iPhone smoke: passcode → Today shows count → review flips → finish → count decreased → streak=1

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Wait for CI and manual review.** Address any feedback as additional commits on the same branch. Do not merge — that's the owner's job.

---

## Self-review notes

- **Spec coverage:**
  - Items + review_state + reviews + sessions tables → Task 1 ✓
  - Vocab Zod schema → Task 2 ✓
  - `external_id` + unique-on-(source, external_id) for idempotent re-imports → Task 1 + Task 12 ✓
  - Leitner state machine (5 boxes, intervals, new-as-exposure) → Task 4 ✓
  - GET /api/queue with new-item threshold (<10) and cap (10) → Task 5 ✓
  - Sessions POST/PATCH → Task 6 ✓
  - POST /api/reviews with idempotency on (item_id, reviewed_at) → Task 7 ✓
  - Streak endpoint with IANA tz → Task 8 ✓
  - Seed import: parse, batch Claude, kuromoji, ON CONFLICT DO NOTHING → Tasks 9–12 ✓
  - RubyText sanitizer with <ruby>/<rt>/<rp> allowlist → Task 2 + Task 14 ✓
  - FlipCard with prompt/answer faces, thumb-zone buttons → Task 16 ✓
  - Bottom tabs with 4 tabs (Browse/Stats stubs) → Task 17 ✓
  - Today screen with real due count + streak + Start button → Task 18 ✓
  - Practice screen with optimistic submit + 3× retry, no IndexedDB → Task 19 ✓
  - frontend-design skill invocation for visual treatment → Task 15 ✓
  - Playwright extension covering full review flow → Task 20 ✓
  - Manual prod import + smoke → Tasks 21–22 ✓
- **Type consistency:**
  - `nextState(prev, result, now)` signature consistent across `leitner.ts`, `leitner.test.ts`, `reviews.ts` ✓
  - `ReviewStateRow` shape matches the columns referenced in the upsert in `reviews.ts` ✓
  - `ItemRecord`, `QueueResponse`, `ReviewStateResponse` from `shared` consumed identically by client and server ✓
  - `auth` module API (`get`/`set`/`clear`) unchanged from Phase 0 ✓
  - The `app.use("/api/...")` mounts in `index.ts` match the test app mounts in `test-helpers/app.ts` ✓
  - `submitReview` shape matches `SubmitReviewRequest` Zod schema and the route's `Body` Zod schema ✓
- **Decomposition:** Each task has one responsibility; each commit is small. The seed workspace is cleanly isolated from the runtime so its kuromoji + Anthropic deps don't bloat the server.
- **Phase 1 scope adherence:** No grammar/reading/conjugation/particle code. No `/api/generate`. No Browse/Stats logic. No IndexedDB.
