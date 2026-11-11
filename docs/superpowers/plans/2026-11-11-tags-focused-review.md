# Tags + Focused Ready for Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn study lists into tags on ordinary items, let Ready for Review take an optional skill/tag focus (with a schedule-neutral drill fallback), and replace the Study tab with a Library tab.

**Architecture:** One migration renames `study_lists`/`study_list_items` to `tags`/`item_tags` (merging duplicate names) and adds `sessions.tag_filter`. A shared `Focus` type flows through a single SQL helper (`focusClause`) used by the queue, the dashboard, and the library, so all three filter identically. Grading gains `mode: "scheduled" | "drill"`; drill logs history but never touches `review_state`.

**Tech Stack:** TypeScript (ESM, Node ≥ 24), Zod, Express, Postgres 16 via `pg`, node-pg-migrate (raw SQL), Vitest + supertest (real Postgres), React + Vite, Playwright (`iphone-14`, single worker).

**Spec:** `docs/superpowers/specs/2026-11-11-tags-focused-review-design.md`

## Global Constraints

- ESM only; relative imports inside `server/` end in `.js`. Cross-workspace imports go through `@nihongo/shared` / `@nihongo/gen`.
- Every request/response body is a Zod schema in `shared/src/types.ts`; change `shared` first.
- Never edit an applied migration; new file `db/migrations/<epoch-ms>_<slug>.sql` with a larger timestamp than `1783987200000`.
- Tables holding per-learner state must be in the `TRUNCATE` list in `server/src/db/reset.ts`.
- Client CSS: no hard-coded colours (tokens only), 44px touch targets, ruby line-height untouched (`client/src/styles/README.md`).
- Daily allowance and new-card share stay **global**; a focus narrows which cards are dealt, never how many the day allows.
- Drill cap: **50** when the focus has no tag; uncapped with a tag.
- Drill reviews: `free_practice = true`, `box_before = box_after = current box (0 if never studied)`, no `review_state` write, no Hermes emit.
- New-card order everywhere: `has any item_tags row DESC, created_at ASC`.
- Tag names unique on `lower(btrim(name))`; clash → HTTP 409 `TAG_EXISTS`.
- `items.tags text[]` (internal `lesson:<uuid>` labels) is never shown as a user tag. User tags are exposed as **`user_tags: {id, name}[]`** (named so to avoid clashing with the existing `tags: string[]` field on `ItemRecord`/`ItemDetailResponse`).
- Server tests: `DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo PASSCODE=test` (local DB must be migrated: `npm run db:migrate`).

## Review Focus

1. **Stale focus after a tag is deleted or renamed** — a focus saved in `localStorage` pointing at a deleted tag must fall back to no focus, not 404-loop the dashboard. Pinned in Task 8 (`loadFocus` validation against the fetched tag list) and Task 4 (queue/dashboard return 404 `TAG_NOT_FOUND`, client clears focus on 404).
2. **Drilling a brand-new card twice in the same millisecond / retrying a drill grade** — the idempotency path today reads `review_state` and crashes when there is none. Pinned in Task 3 (duplicate drill submit of a never-studied card returns 200).
3. **Tag name whitespace/case** — "Coto Academy " vs "coto academy" must clash on create *and* rename. Pinned in Task 2.
4. **Drill on a skill-only focus with thousands of cards** — must cap at 50, not ship the whole deck to the phone. Pinned in Task 4.
5. **Hero/session agreement under focus** — the hero number for a focus must equal what the focused queue deals (the original daily-target bug, now per focus). Pinned in Task 5 (dashboard test asserts `session_size` equals the queue length for skill, tag, and skill×tag focuses).

---

### Task 1: Migration — study lists become tags

**Files:**
- Create: `db/migrations/1784073600000_study_lists_to_tags.sql`
- Modify: `server/src/db/reset.ts`
- Create: `server/src/db/tags-schema.test.ts`

**Interfaces:**
- Produces: tables `tags(id uuid, name text, description text, created_at timestamptz)`, `item_tags(tag_id uuid, item_id uuid, added_at timestamptz)`, PK `(tag_id, item_id)`, unique index `tags_name_lower_idx` on `lower(btrim(name))`, index `item_tags_item_idx`; column `sessions.tag_filter uuid NULL REFERENCES tags(id) ON DELETE SET NULL`.

- [ ] **Step 1: Write the failing schema test**

```ts
// server/src/db/tags-schema.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { pool } from "./pool.js";
import { resetDb } from "./reset.js";

beforeEach(async () => { await resetDb(); });

async function insertItem(): Promise<string> {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source) VALUES ('vocab', '{}', '{}', 'seed') RETURNING id`,
  );
  return r.rows[0].id;
}

describe("tags schema", () => {
  it("stores a tag with members", async () => {
    const t = await pool.query(`INSERT INTO tags (name) VALUES ('Coto Academy') RETURNING id`);
    const itemId = await insertItem();
    await pool.query(`INSERT INTO item_tags (tag_id, item_id) VALUES ($1, $2)`, [t.rows[0].id, itemId]);
    const r = await pool.query(`SELECT count(*)::int AS c FROM item_tags WHERE item_id = $1`, [itemId]);
    expect(r.rows[0].c).toBe(1);
  });

  it("rejects a name differing only by case and surrounding whitespace", async () => {
    await pool.query(`INSERT INTO tags (name) VALUES ('Coto Academy')`);
    await expect(pool.query(`INSERT INTO tags (name) VALUES ('  coto academy ')`))
      .rejects.toMatchObject({ code: "23505" });
  });

  it("deleting a tag keeps the item", async () => {
    const t = await pool.query(`INSERT INTO tags (name) VALUES ('X') RETURNING id`);
    const itemId = await insertItem();
    await pool.query(`INSERT INTO item_tags (tag_id, item_id) VALUES ($1, $2)`, [t.rows[0].id, itemId]);
    await pool.query(`DELETE FROM tags WHERE id = $1`, [t.rows[0].id]);
    const r = await pool.query(`SELECT count(*)::int AS c FROM items WHERE id = $1`, [itemId]);
    expect(r.rows[0].c).toBe(1);
  });

  it("sessions can record a tag filter", async () => {
    const t = await pool.query(`INSERT INTO tags (name) VALUES ('X') RETURNING id`);
    const s = await pool.query(`INSERT INTO sessions (tag_filter) VALUES ($1) RETURNING tag_filter`, [t.rows[0].id]);
    expect(s.rows[0].tag_filter).toBe(t.rows[0].id);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (cwd `server/`): `DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo PASSCODE=test npx vitest run src/db/tags-schema.test.ts`
Expected: FAIL — `relation "tags" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- 1784073600000_study_lists_to_tags.sql
-- Study lists become tags. A list was always just a label on ordinary items —
-- members kept their own review_state and flowed through the normal SRS — so
-- the model now says so: `tags` + `item_tags`. Ids, names, descriptions and
-- members carry over; an item in several lists ends up with several tags.
-- `position` goes: there is no hand-ordering inside a tag.

-- Merge lists whose names collide case-/whitespace-insensitively into the
-- earliest-created one, before the unique index can reject them.
WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(title)) ORDER BY created_at, id) AS keep_id
    FROM study_lists
), dupes AS (
  SELECT id, keep_id FROM ranked WHERE id <> keep_id
)
INSERT INTO study_list_items (list_id, item_id, position, added_at)
SELECT d.keep_id, sli.item_id, 0, min(sli.added_at)
  FROM study_list_items sli JOIN dupes d ON d.id = sli.list_id
 GROUP BY d.keep_id, sli.item_id
ON CONFLICT (list_id, item_id) DO UPDATE
  SET added_at = LEAST(study_list_items.added_at, EXCLUDED.added_at);

DELETE FROM study_lists sl
 USING (
   SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(title)) ORDER BY created_at, id) AS keep_id
     FROM study_lists
 ) r
 WHERE sl.id = r.id AND r.id <> r.keep_id;

ALTER TABLE study_lists RENAME TO tags;
ALTER TABLE tags RENAME COLUMN title TO name;
ALTER TABLE tags RENAME CONSTRAINT study_lists_pkey TO tags_pkey;
UPDATE tags SET name = btrim(name);
CREATE UNIQUE INDEX tags_name_lower_idx ON tags (lower(btrim(name)));

ALTER TABLE study_list_items RENAME TO item_tags;
ALTER TABLE item_tags RENAME COLUMN list_id TO tag_id;
ALTER TABLE item_tags DROP COLUMN position;
ALTER TABLE item_tags RENAME CONSTRAINT study_list_items_pkey TO item_tags_pkey;
ALTER TABLE item_tags RENAME CONSTRAINT study_list_items_list_id_fkey TO item_tags_tag_id_fkey;
ALTER TABLE item_tags RENAME CONSTRAINT study_list_items_item_id_fkey TO item_tags_item_id_fkey;
ALTER INDEX study_list_items_list_idx RENAME TO item_tags_tag_idx;
CREATE INDEX item_tags_item_idx ON item_tags (item_id);

-- Session history records the whole focus, not just the skill.
ALTER TABLE sessions ADD COLUMN tag_filter uuid REFERENCES tags(id) ON DELETE SET NULL;
```

If `npm run db:migrate` reports a constraint name doesn't exist, confirm the real names with
`psql "$DATABASE_URL" -c '\d study_list_items'` on a database migrated to `1783987200000` and use
those (Postgres default naming is `<table>_<column>_fkey` / `<table>_pkey`).

- [ ] **Step 4: Update `reset.ts`**

In `server/src/db/reset.ts` replace `study_lists` in the `TRUNCATE` list with `tags` (CASCADE clears `item_tags`):

```ts
    TRUNCATE TABLE reviews, review_state, items, sessions, generations, lessons, kanji, tags, daily_rounds
```

- [ ] **Step 5: Migrate and run the test**

Run (repo root): `npm run db:migrate`, then the Step 2 command.
Expected: 4 passed. (The old `study-lists.test.ts` will now fail — it is replaced in Task 2; don't run the whole suite yet.)

- [ ] **Step 6: Verify the merge on a scratch database**

```bash
createdb -h localhost -U nihongo nihongo_mergecheck
DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo_mergecheck npx node-pg-migrate up 1783987200000_kanji_mnemonics -m db/migrations --migration-file-language sql
psql postgres://nihongo:nihongo@localhost:5432/nihongo_mergecheck <<'SQL'
INSERT INTO items (id, skill, prompt, answer, source) VALUES
 ('00000000-0000-0000-0000-00000000000a','vocab','{}','{}','seed'),
 ('00000000-0000-0000-0000-00000000000b','vocab','{}','{}','seed');
INSERT INTO study_lists (id, title, created_at) VALUES
 ('10000000-0000-0000-0000-000000000001','Coto Academy','2026-01-01'),
 ('10000000-0000-0000-0000-000000000002',' coto academy','2026-02-01');
INSERT INTO study_list_items (list_id, item_id) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000b');
SQL
DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo_mergecheck npm run db:migrate
psql postgres://nihongo:nihongo@localhost:5432/nihongo_mergecheck -c "SELECT t.name, count(*) FROM tags t JOIN item_tags it ON it.tag_id=t.id GROUP BY t.name"
dropdb -h localhost -U nihongo nihongo_mergecheck
```

Expected: one row, `Coto Academy | 2`. If the `node-pg-migrate up <name>` invocation differs from `server/src/db/migrate.ts`, read that file and use its runner with a count instead — the goal is a DB at the previous migration.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/1784073600000_study_lists_to_tags.sql server/src/db/reset.ts server/src/db/tags-schema.test.ts
git commit -m "feat(db): study lists become tags; sessions record tag filter"
```

---

### Task 2: Shared tag schemas + tags service and routes

**Files:**
- Modify: `shared/src/types.ts` (Study lists section → Tags section; `LibraryItem`; `ItemDetailResponse`)
- Create: `server/src/services/tags.ts` (replaces `server/src/services/study-lists.ts`)
- Create: `server/src/routes/tags.ts` (replaces `server/src/routes/study-lists.ts`)
- Create: `server/src/routes/tags.test.ts` (replaces `server/src/routes/study-lists.test.ts`)
- Delete: `server/src/services/study-lists.ts`, `server/src/routes/study-lists.ts`, `server/src/routes/study-lists.test.ts`
- Modify: `server/src/index.ts` (mount `/api/tags`)

**Interfaces:**
- Produces (shared): `TagRef {id, name}`, `TagSummary {id, name, description, item_count, avg_mastery, created_at}`, `TagsResponse {tags: TagSummary[]}`, `CreateTagRequest {name, description?}`, `UpdateTagRequest {name?, description?}`, `CreateTagResponse {id}`, `QuickAddPreviewRequest`, `QuickAddPreviewResponse`, `QuickAddItemRequest`, `QuickAddItemResponse`, `TagCandidatesResponse {items: LibraryItem[]}`, `LibraryItem` gains `user_tags: TagRef[]`, `ItemDetailResponse` gains `user_tags: TagRef[]`.
- Produces (server): `tagsRouter` at `/api/tags`; service functions `listTags()`, `createTag(name, description)`, `updateTag(id, patch)`, `deleteTag(id)`, `tagItem(tagId, itemId)`, `untagItem(tagId, itemId)`, `previewQuickItem(req)`, `quickAddItem(tagId, req)`, `searchCandidates(tagId, q, skill?)`, `userTagsSql(alias)`.

- [ ] **Step 1: Replace the Study lists section of `shared/src/types.ts`**

Delete everything from `// ----- Study lists -----` through `export type StudyCramResponse …` and add:

```ts
// ----- Tags -----
//
// A tag labels ordinary `items` (e.g. "Coto Academy"). Tagged items flow
// through the normal SRS, are introduced before untagged ones, and can be the
// focus of a review session. Was "study lists" until 2026-11.

export const TagRef = z.object({ id: z.string().uuid(), name: z.string() });
export type TagRef = z.infer<typeof TagRef>;

export const TagSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  item_count: z.number().int().nonnegative(),
  avg_mastery: z.number().min(0).max(1),
  created_at: z.string(),
});
export type TagSummary = z.infer<typeof TagSummary>;

export const TagsResponse = z.object({ tags: z.array(TagSummary) });
export type TagsResponse = z.infer<typeof TagsResponse>;

const TagName = z.string().trim().min(1).max(60);

export const CreateTagRequest = z.object({
  name: TagName,
  description: z.string().max(400).optional(),
});
export type CreateTagRequest = z.infer<typeof CreateTagRequest>;

export const UpdateTagRequest = z.object({
  name: TagName.optional(),
  description: z.string().max(400).optional(),
}).refine((b) => b.name !== undefined || b.description !== undefined, "nothing to update");
export type UpdateTagRequest = z.infer<typeof UpdateTagRequest>;

export const CreateTagResponse = z.object({ id: z.string().uuid() });
export type CreateTagResponse = z.infer<typeof CreateTagResponse>;

// Quick-add is a two-step flow: the learner types a word / kanji / grammar
// pattern, the server drafts editable fields, the learner tweaks, then saves.
// Vocab & grammar use the AI; kanji fills from the seeded reference table.

export const QuickAddVocabFields = z.object({
  japanese: z.string().min(1).max(120),
  english: z.string().min(1).max(120),
  sentence_japanese: z.string().min(1).max(200),
  sentence_english: z.string().min(1).max(200),
});
export type QuickAddVocabFields = z.infer<typeof QuickAddVocabFields>;

export const QuickAddGrammarFields = z.object({
  pattern: z.string().min(1).max(120),
  explanation: z.string().min(1).max(400),
  sentence_japanese: z.string().max(200),
  sentence_english: z.string().max(200),
});
export type QuickAddGrammarFields = z.infer<typeof QuickAddGrammarFields>;

export const QuickAddPreviewRequest = z.object({
  kind: z.enum(["vocab", "kanji", "grammar"]),
  input: z.string().min(1).max(200),
});
export type QuickAddPreviewRequest = z.infer<typeof QuickAddPreviewRequest>;

export const QuickAddPreviewResponse = z.discriminatedUnion("kind", [
  QuickAddVocabFields.extend({ kind: z.literal("vocab"), cost_usd: z.number().nonnegative() }),
  QuickAddGrammarFields.extend({ kind: z.literal("grammar"), cost_usd: z.number().nonnegative() }),
  z.object({
    kind: z.literal("kanji"),
    character: z.string(),
    meaning: z.string(),
    readings: z.string(),
    cost_usd: z.number().nonnegative(),
  }),
]);
export type QuickAddPreviewResponse = z.infer<typeof QuickAddPreviewResponse>;

export const QuickAddItemRequest = z.discriminatedUnion("kind", [
  QuickAddVocabFields.extend({ kind: z.literal("vocab") }),
  QuickAddGrammarFields.extend({ kind: z.literal("grammar") }),
  z.object({
    kind: z.literal("kanji"),
    character: z.string().min(1).max(4),
    meaning: z.string().max(200),
  }),
]);
export type QuickAddItemRequest = z.infer<typeof QuickAddItemRequest>;

export const QuickAddItemResponse = z.object({ item_id: z.string().uuid() });
export type QuickAddItemResponse = z.infer<typeof QuickAddItemResponse>;

export const TagCandidatesResponse = z.object({ items: z.array(LibraryItem) });
export type TagCandidatesResponse = z.infer<typeof TagCandidatesResponse>;
```

Because `LibraryItem` is defined earlier in the file, move the `TagRef` definition (only `TagRef`) up to just above `LibraryItem`, and add to `LibraryItem` and `ItemDetailResponse`:

```ts
  user_tags: z.array(TagRef),   // learner-facing tags; `tags` (string[]) stays internal
```

Run `npm --workspace shared run build` (tsc --noEmit). Expected: shared compiles; server/client will not yet — fixed below and in later tasks.

- [ ] **Step 2: Write the failing route tests**

```ts
// server/src/routes/tags.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { tagsRouter } from "./tags.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/tags", tagsRouter));
const auth = (r: request.Test) => r.set("X-Passcode", PASSCODE);

async function insertVocab(target: string, meaning: string): Promise<string> {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ('vocab', $1, $2, 'seed', $3) RETURNING id`,
    [JSON.stringify({ sentence_ruby: target, target, sentence_english: meaning }),
     JSON.stringify({ meaning, reading: "x" }), `e-${Math.random()}`],
  );
  return r.rows[0].id;
}
async function createTag(name = "Coto Academy"): Promise<string> {
  const res = await auth(request(app).post("/api/tags")).send({ name });
  expect(res.status).toBe(201);
  return res.body.id;
}

beforeEach(async () => { await resetDb(); process.env.NIHONGO_FAKE_AI = "1"; });
afterEach(() => { delete process.env.NIHONGO_FAKE_AI; });

describe("tags", () => {
  it("requires passcode", async () => {
    expect((await request(app).get("/api/tags")).status).toBe(401);
  });

  it("creates and lists a tag with count and mastery", async () => {
    const id = await createTag();
    const a = await insertVocab("水", "water");
    const b = await insertVocab("火", "fire");
    await pool.query(`INSERT INTO review_state (item_id, box) VALUES ($1, 5)`, [a]);
    await auth(request(app).put(`/api/tags/${id}/items/${a}`)).expect(204);
    await auth(request(app).put(`/api/tags/${id}/items/${b}`)).expect(204);
    const res = await auth(request(app).get("/api/tags"));
    expect(res.body.tags).toEqual([
      expect.objectContaining({ id, name: "Coto Academy", item_count: 2, avg_mastery: 0.5 }),
    ]);
  });

  it("trims names and rejects case/whitespace clashes on create and rename", async () => {
    await createTag("Coto Academy");
    const dup = await auth(request(app).post("/api/tags")).send({ name: "  coto academy " });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("TAG_EXISTS");
    const other = await createTag("Week 5");
    const ren = await auth(request(app).patch(`/api/tags/${other}`)).send({ name: "COTO ACADEMY" });
    expect(ren.status).toBe(409);
  });

  it("renames and edits description", async () => {
    const id = await createTag("Week 5");
    await auth(request(app).patch(`/api/tags/${id}`)).send({ name: "Week 6", description: "n4" }).expect(204);
    const res = await auth(request(app).get("/api/tags"));
    expect(res.body.tags[0]).toMatchObject({ name: "Week 6", description: "n4" });
  });

  it("tagging is idempotent and untag removes only the label", async () => {
    const id = await createTag();
    const a = await insertVocab("水", "water");
    await auth(request(app).put(`/api/tags/${id}/items/${a}`)).expect(204);
    await auth(request(app).put(`/api/tags/${id}/items/${a}`)).expect(204);
    await auth(request(app).delete(`/api/tags/${id}/items/${a}`)).expect(204);
    const items = await pool.query(`SELECT count(*)::int AS c FROM items`);
    expect(items.rows[0].c).toBe(1);
  });

  it("404s tagging an unknown tag or item", async () => {
    const id = await createTag();
    const a = await insertVocab("水", "water");
    const unknown = "00000000-0000-0000-0000-000000000000";
    expect((await auth(request(app).put(`/api/tags/${unknown}/items/${a}`))).body.code).toBe("TAG_NOT_FOUND");
    expect((await auth(request(app).put(`/api/tags/${id}/items/${unknown}`))).body.code).toBe("ITEM_NOT_FOUND");
  });

  it("delete removes the tag but keeps items and review state", async () => {
    const id = await createTag();
    const a = await insertVocab("水", "water");
    await pool.query(`INSERT INTO review_state (item_id, box) VALUES ($1, 3)`, [a]);
    await auth(request(app).put(`/api/tags/${id}/items/${a}`)).expect(204);
    await auth(request(app).delete(`/api/tags/${id}`)).expect(204);
    const rs = await pool.query(`SELECT box FROM review_state WHERE item_id = $1`, [a]);
    expect(rs.rows[0].box).toBe(3);
    expect((await auth(request(app).delete(`/api/tags/${id}`))).status).toBe(404);
  });

  it("quick-add creates a user item and tags it", async () => {
    const id = await createTag();
    const res = await auth(request(app).post(`/api/tags/${id}/quick-add`)).send({
      kind: "vocab", japanese: "テスト", english: "test",
      sentence_japanese: "テストです。", sentence_english: "It's a test.",
    });
    expect(res.status).toBe(201);
    const t = await pool.query(`SELECT 1 FROM item_tags WHERE tag_id = $1 AND item_id = $2`, [id, res.body.item_id]);
    expect(t.rowCount).toBe(1);
  });

  it("preview drafts fields without writing", async () => {
    const res = await auth(request(app).post("/api/tags/preview")).send({ kind: "vocab", input: "test" });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("vocab");
    expect((await pool.query(`SELECT count(*)::int AS c FROM items`)).rows[0].c).toBe(0);
  });

  it("candidates exclude items already carrying the tag and include user_tags", async () => {
    const id = await createTag();
    const a = await insertVocab("水", "water");
    const b = await insertVocab("水曜日", "wednesday");
    await auth(request(app).put(`/api/tags/${id}/items/${a}`)).expect(204);
    const res = await auth(request(app).get(`/api/tags/${id}/candidates?q=水`));
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([b]);
    expect(res.body.items[0].user_tags).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run (cwd `server/`): `DATABASE_URL=… PASSCODE=test npx vitest run src/routes/tags.test.ts`
Expected: FAIL — cannot resolve `./tags.js`.

- [ ] **Step 4: Write `server/src/services/tags.ts`**

Start by `git mv server/src/services/study-lists.ts server/src/services/tags.ts`, then make it:

```ts
import { randomUUID } from "node:crypto";
import {
  toRubyHtml, readingFor, computeCost,
  generateManualVocab, generateManualGrammar,
} from "@nihongo/gen";
import { pool } from "../db/pool.js";
import type {
  TagSummary, TagRef, LibraryItem,
  QuickAddItemRequest, QuickAddPreviewRequest, QuickAddPreviewResponse, Skill,
} from "@nihongo/shared";
import { itemDisplay, boxToMastery } from "./item-display.js";

// SQL expression yielding an item's learner-facing tags as a JSON array of
// {id, name}, sorted by name. `alias` is the items alias in the outer query.
export function userTagsSql(alias: string): string {
  return `COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
                      FROM item_tags it JOIN tags t ON t.id = it.tag_id
                     WHERE it.item_id = ${alias}.id), '[]'::json)`;
}

type SummaryRow = { id: string; name: string; description: string; created_at: Date; item_count: number; mastery_sum: number };

// Average mastery uses the same box→mastery mapping as item-display
// (box/5, never-studied = 0), computed in SQL so it covers every member.
const SUMMARY_SELECT = `
  SELECT t.id, t.name, t.description, t.created_at,
         count(it.item_id)::int AS item_count,
         COALESCE(sum(LEAST(COALESCE(rs.box, 0), 5) / 5.0), 0)::float AS mastery_sum
    FROM tags t
    LEFT JOIN item_tags it ON it.tag_id = t.id
    LEFT JOIN review_state rs ON rs.item_id = it.item_id`;

function toSummary(r: SummaryRow): TagSummary {
  return {
    id: r.id, name: r.name, description: r.description,
    item_count: r.item_count,
    avg_mastery: r.item_count === 0 ? 0 : r.mastery_sum / r.item_count,
    created_at: r.created_at.toISOString(),
  };
}

export async function listTags(): Promise<TagSummary[]> {
  const r = await pool.query<SummaryRow>(`${SUMMARY_SELECT} GROUP BY t.id ORDER BY lower(t.name)`);
  return r.rows.map(toSummary);
}

export async function tagExists(id: string): Promise<boolean> {
  const r = await pool.query(`SELECT 1 FROM tags WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

export class TagExistsError extends Error {}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export async function createTag(name: string, description: string): Promise<{ id: string }> {
  try {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO tags (name, description) VALUES (btrim($1), $2) RETURNING id`, [name, description],
    );
    return { id: r.rows[0]!.id };
  } catch (err) {
    if (isUniqueViolation(err)) throw new TagExistsError(name);
    throw err;
  }
}

export async function updateTag(id: string, patch: { name?: string; description?: string }): Promise<boolean> {
  try {
    const r = await pool.query(
      `UPDATE tags SET name = COALESCE(btrim($2), name), description = COALESCE($3, description) WHERE id = $1`,
      [id, patch.name ?? null, patch.description ?? null],
    );
    return (r.rowCount ?? 0) > 0;
  } catch (err) {
    if (isUniqueViolation(err)) throw new TagExistsError(patch.name ?? "");
    throw err;
  }
}

// Removes the label only: item_tags rows cascade, items and review_state stay.
export async function deleteTag(id: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM tags WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

export async function tagItem(tagId: string, itemId: string): Promise<"ok" | "no_tag" | "no_item"> {
  if (!(await tagExists(tagId))) return "no_tag";
  const item = await pool.query(`SELECT 1 FROM items WHERE id = $1`, [itemId]);
  if ((item.rowCount ?? 0) === 0) return "no_item";
  await pool.query(
    `INSERT INTO item_tags (tag_id, item_id) VALUES ($1, $2) ON CONFLICT (tag_id, item_id) DO NOTHING`,
    [tagId, itemId],
  );
  return "ok";
}

export async function untagItem(tagId: string, itemId: string): Promise<void> {
  await pool.query(`DELETE FROM item_tags WHERE tag_id = $1 AND item_id = $2`, [tagId, itemId]);
}
```

Keep `lookupKanji`, `buildQuickItem` and `previewQuickItem` from the old file verbatim, changing only the type names (`QuickAddStudyItemRequest` → `QuickAddItemRequest`, `StudyPreviewRequest` → `QuickAddPreviewRequest`, `StudyPreviewResponse` → `QuickAddPreviewResponse`). Then replace `quickAddItem` and `searchCandidates`:

```ts
// Create a new user item from the (edited) preview and tag it, in one transaction.
export async function quickAddItem(tagId: string, req: QuickAddItemRequest): Promise<{ item_id: string } | null> {
  const built = await buildQuickItem(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tag = await client.query(`SELECT 1 FROM tags WHERE id = $1`, [tagId]);
    if ((tag.rowCount ?? 0) === 0) { await client.query("ROLLBACK"); return null; }
    const ir = await client.query<{ id: string }>(
      `INSERT INTO items (skill, prompt, answer, source, external_id)
       VALUES ($1, $2, $3, 'user', $4) RETURNING id`,
      [built.skill, JSON.stringify(built.prompt), JSON.stringify(built.answer), `user-${randomUUID()}`],
    );
    const itemId = ir.rows[0]!.id;
    await client.query(`INSERT INTO item_tags (tag_id, item_id) VALUES ($1, $2)`, [tagId, itemId]);
    await client.query("COMMIT");
    return { item_id: itemId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

type CandidateRow = { id: string; skill: string; prompt: unknown; answer: unknown; box: number | null; user_tags: TagRef[] };

// Items NOT already carrying the tag, matching `q` as a case-insensitive
// substring of the stored prompt/answer JSON. Capped at 30.
export async function searchCandidates(tagId: string, q: string, skill?: string): Promise<LibraryItem[]> {
  const params: unknown[] = [tagId, q];
  let skillClause = "";
  if (skill) { params.push(skill); skillClause = `AND i.skill = $${params.length}`; }
  const r = await pool.query<CandidateRow>(
    `SELECT i.id, i.skill, i.prompt, i.answer, rs.box, ${userTagsSql("i")} AS user_tags
       FROM items i
       LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE (i.prompt::text ILIKE '%' || $2 || '%' OR i.answer::text ILIKE '%' || $2 || '%')
        ${skillClause}
        AND NOT EXISTS (SELECT 1 FROM item_tags it WHERE it.tag_id = $1 AND it.item_id = i.id)
      ORDER BY i.created_at DESC
      LIMIT 30`,
    params,
  );
  return r.rows.map((row) => {
    const d = itemDisplay(row.skill as Skill, row.prompt, row.answer);
    return { id: row.id, skill: row.skill as Skill, front: d.front, reading: d.reading,
             meaning: d.meaning, mastery: boxToMastery(row.box), user_tags: row.user_tags };
  });
}
```

Delete `getStudyListDetail`, `getCramItems`, `addItem`, `removeItem`, `listStudyLists`, `createStudyList`, `deleteStudyList`.

- [ ] **Step 5: Write `server/src/routes/tags.ts`**

`git mv server/src/routes/study-lists.ts server/src/routes/tags.ts` and replace its contents:

```ts
import { Router } from "express";
import {
  CreateTagRequest, UpdateTagRequest, QuickAddItemRequest, QuickAddPreviewRequest,
} from "@nihongo/shared";
import { GenerateError } from "@nihongo/gen";
import {
  listTags, createTag, updateTag, deleteTag, tagItem, untagItem,
  quickAddItem, searchCandidates, previewQuickItem, TagExistsError,
} from "../services/tags.js";

export const tagsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const badBody = (msg?: string) => ({ error: msg ?? "invalid input", code: "BAD_BODY" });
const tagNotFound = { error: "tag not found", code: "TAG_NOT_FOUND" };
const tagExists = { error: "a tag with that name already exists", code: "TAG_EXISTS" };

// Non-uuid ids are a plain 404 instead of a Postgres cast error.
tagsRouter.param("id", (req, res, next, id: string) => {
  if (!UUID_RE.test(id)) { res.status(404).json(tagNotFound); return; }
  next();
});

// POST /api/tags/preview — draft editable fields (no DB write). Before /:id routes.
tagsRouter.post("/preview", async (req, res) => {
  const parsed = QuickAddPreviewRequest.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(badBody(parsed.error.errors[0]?.message)); return; }
  try {
    res.json(await previewQuickItem(parsed.data));
  } catch (err) {
    const message = err instanceof GenerateError ? err.message : err instanceof Error ? err.message : "generation failed";
    res.status(502).json({ error: message, code: "PREVIEW_FAILED" });
  }
});

tagsRouter.get("/", async (_req, res) => {
  res.json({ tags: await listTags() });
});

tagsRouter.post("/", async (req, res) => {
  const parsed = CreateTagRequest.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(badBody(parsed.error.errors[0]?.message)); return; }
  try {
    const { id } = await createTag(parsed.data.name, (parsed.data.description ?? "").trim());
    res.status(201).json({ id });
  } catch (err) {
    if (err instanceof TagExistsError) { res.status(409).json(tagExists); return; }
    throw err;
  }
});

tagsRouter.patch("/:id", async (req, res) => {
  const parsed = UpdateTagRequest.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(badBody(parsed.error.errors[0]?.message)); return; }
  try {
    const ok = await updateTag(req.params.id, parsed.data);
    if (!ok) { res.status(404).json(tagNotFound); return; }
    res.status(204).end();
  } catch (err) {
    if (err instanceof TagExistsError) { res.status(409).json(tagExists); return; }
    throw err;
  }
});

tagsRouter.delete("/:id", async (req, res) => {
  if (!(await deleteTag(req.params.id))) { res.status(404).json(tagNotFound); return; }
  res.status(204).end();
});

tagsRouter.put("/:id/items/:itemId", async (req, res) => {
  if (!UUID_RE.test(req.params.itemId)) { res.status(404).json({ error: "item not found", code: "ITEM_NOT_FOUND" }); return; }
  const r = await tagItem(req.params.id, req.params.itemId);
  if (r === "no_tag") { res.status(404).json(tagNotFound); return; }
  if (r === "no_item") { res.status(404).json({ error: "item not found", code: "ITEM_NOT_FOUND" }); return; }
  res.status(204).end();
});

tagsRouter.delete("/:id/items/:itemId", async (req, res) => {
  if (UUID_RE.test(req.params.itemId)) await untagItem(req.params.id, req.params.itemId);
  res.status(204).end();
});

tagsRouter.post("/:id/quick-add", async (req, res) => {
  const parsed = QuickAddItemRequest.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(badBody(parsed.error.errors[0]?.message)); return; }
  const r = await quickAddItem(req.params.id, parsed.data);
  if (!r) { res.status(404).json(tagNotFound); return; }
  res.status(201).json(r);
});

tagsRouter.get("/:id/candidates", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) { res.json({ items: [] }); return; }
  const skill = typeof req.query.skill === "string" ? req.query.skill : undefined;
  res.json({ items: await searchCandidates(req.params.id, q, skill) });
});
```

Check the old `quick-add` route's status code in git (`git show HEAD:server/src/routes/study-lists.ts | grep -n quick-add -A12`). If it returned 200, keep 200 and change the test's `toBe(201)` to match — the client doesn't branch on it.

- [ ] **Step 6: Mount the router**

In `server/src/index.ts` replace the `studyListsRouter` import and `app.use("/api/study-lists", studyListsRouter);` with:

```ts
import { tagsRouter } from "./routes/tags.js";
// …
  app.use("/api/tags", tagsRouter);
```

Delete `server/src/routes/study-lists.test.ts`.

- [ ] **Step 7: Fill `user_tags` on item detail**

In `server/src/routes/items.ts`, in the `GET /:id` query add `${userTagsSql("i")} AS user_tags` to the SELECT (import `userTagsSql` from `../services/tags.js`), add `user_tags: TagRef[]` to `ItemRow`, and `user_tags: row.user_tags` to the response. Add to `server/src/routes/items.test.ts`:

```ts
  it("includes learner-facing tags on the detail", async () => {
    const id = await insertVocabItem();               // use the file's existing item helper
    const t = await pool.query(`INSERT INTO tags (name) VALUES ('Coto Academy') RETURNING id`);
    await pool.query(`INSERT INTO item_tags (tag_id, item_id) VALUES ($1, $2)`, [t.rows[0].id, id]);
    const res = await auth(request(app).get(`/api/items/${id}`));
    expect(res.body.user_tags).toEqual([{ id: t.rows[0].id, name: "Coto Academy" }]);
  });
```

(Use whatever item-insert helper and auth wrapper `items.test.ts` already defines; rename `insertVocabItem`/`auth` to match.)

- [ ] **Step 8: Run tests**

Run (cwd `server/`): `DATABASE_URL=… PASSCODE=test npx vitest run src/routes/tags.test.ts src/routes/items.test.ts src/db/tags-schema.test.ts`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A shared/src/types.ts server/src
git commit -m "feat(server): tags API replaces study lists; user_tags on item detail"
```

---

### Task 3: Drill grading leaves the schedule alone

**Files:**
- Modify: `shared/src/types.ts` (`ReviewMode`, `SubmitReviewRequest.mode`, `DrillReviewResponse`)
- Modify: `server/src/routes/reviews.ts`
- Modify: `server/src/services/daily-budget.ts` (`countIntroducedToday`)
- Test: `server/src/routes/reviews.test.ts`, `server/src/services/daily-budget.test.ts`

**Interfaces:**
- Produces: `ReviewMode = z.enum(["scheduled","drill"])`; `SubmitReviewRequest.mode: ReviewMode.optional()` (absent = scheduled); `DrillReviewResponse = { mode: "drill", box: 0..5 }`. Scheduled responses keep `ReviewStateResponse`.

- [ ] **Step 1: Shared schema**

In `shared/src/types.ts`, above `SubmitReviewRequest`:

```ts
// `scheduled` grades through the Leitner schedule. `drill` is practice chosen
// outside the schedule (drill-all-anyway on a focus): it is logged as history
// and kept out of the daily target, but never moves a card's box or due date.
export const ReviewMode = z.enum(["scheduled", "drill"]);
export type ReviewMode = z.infer<typeof ReviewMode>;
```

Add `mode: ReviewMode.optional(),` to `SubmitReviewRequest`, and after `ReviewStateResponse`:

```ts
// A drill reports the card's unchanged box (0 = never studied).
export const DrillReviewResponse = z.object({
  mode: z.literal("drill"),
  box: z.number().int().min(0).max(5),
});
export type DrillReviewResponse = z.infer<typeof DrillReviewResponse>;
```

- [ ] **Step 2: Write failing review tests**

Append to `server/src/routes/reviews.test.ts` (reuse its `app`, `PASSCODE`, item helper, and the mocked `emitReviewLogged`; adapt helper names to the file):

```ts
describe("drill mode", () => {
  it("logs the review without touching review_state", async () => {
    const id = await insertItem();                                   // file's helper
    const due = new Date(Date.now() + 7 * 86_400_000);
    await pool.query(
      `INSERT INTO review_state (item_id, box, next_review_at, total_reviews) VALUES ($1, 3, $2, 4)`, [id, due],
    );
    const res = await request(app).post("/api/reviews").set("X-Passcode", PASSCODE).send({
      item_id: id, result: "got_it", reviewed_at: new Date().toISOString(), mode: "drill",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: "drill", box: 3 });
    const rs = await pool.query(`SELECT box, next_review_at, total_reviews FROM review_state WHERE item_id = $1`, [id]);
    expect(rs.rows[0]).toMatchObject({ box: 3, total_reviews: 4 });
    expect(rs.rows[0].next_review_at.getTime()).toBe(due.getTime());
    const rv = await pool.query(`SELECT box_before, box_after, free_practice FROM reviews WHERE item_id = $1`, [id]);
    expect(rv.rows[0]).toEqual({ box_before: 3, box_after: 3, free_practice: true });
    expect(emitReviewLogged).not.toHaveBeenCalled();
  });

  it("a drilled brand-new card stays new", async () => {
    const id = await insertItem();
    const res = await request(app).post("/api/reviews").set("X-Passcode", PASSCODE).send({
      item_id: id, result: "missed", reviewed_at: new Date().toISOString(), mode: "drill",
    });
    expect(res.body).toEqual({ mode: "drill", box: 0 });
    const rs = await pool.query(`SELECT 1 FROM review_state WHERE item_id = $1`, [id]);
    expect(rs.rowCount).toBe(0);
  });

  it("a retried drill submit of a never-studied card is idempotent", async () => {
    const id = await insertItem();
    const body = { item_id: id, result: "got_it", reviewed_at: new Date().toISOString(), mode: "drill" };
    await request(app).post("/api/reviews").set("X-Passcode", PASSCODE).send(body).expect(200);
    const again = await request(app).post("/api/reviews").set("X-Passcode", PASSCODE).send(body);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ mode: "drill", box: 0 });
  });

  it("no mode still schedules normally", async () => {
    const id = await insertItem();
    const res = await request(app).post("/api/reviews").set("X-Passcode", PASSCODE).send({
      item_id: id, result: "got_it", reviewed_at: new Date().toISOString(),
    });
    expect(res.body.box).toBe(1);
    const rv = await pool.query(`SELECT free_practice FROM reviews WHERE item_id = $1`, [id]);
    expect(rv.rows[0].free_practice).toBe(false);
  });
});
```

Make sure the `beforeEach` that calls `vi.mocked(emitReviewLogged).mockClear()` also covers this describe (move it to file level if it's scoped).

In `server/src/services/daily-budget.test.ts` add (adapt to its helpers):

```ts
  it("countIntroducedToday ignores drill rows", async () => {
    const id = await insertItem();
    await pool.query(
      `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after, free_practice)
       VALUES ($1, now(), 'got_it', 0, 0, true)`, [id],
    );
    expect(await countIntroducedToday("UTC")).toBe(0);
  });
```

- [ ] **Step 3: Run to verify failure**

Run (cwd `server/`): `DATABASE_URL=… PASSCODE=test npx vitest run src/routes/reviews.test.ts src/services/daily-budget.test.ts`
Expected: the new drill tests FAIL (box advances / free_practice false / review_state row created).

- [ ] **Step 4: Implement drill in `reviews.ts`**

Replace the `free_practice` field in `Body` with:

```ts
  // `drill` = practice outside the schedule: logged (free_practice = true, so
  // it stays out of the daily target) but never moves review_state. See
  // shared ReviewMode.
  mode: z.enum(["scheduled", "drill"]).optional(),
```

Destructure `mode` instead of `free_practice`. Directly after the item-exists check and **before** the duplicate check, insert:

```ts
    if (mode === "drill") {
      const cur = await client.query<{ box: number }>(`SELECT box FROM review_state WHERE item_id = $1`, [item_id]);
      const box = cur.rows[0]?.box ?? 0;
      await client.query(
        `INSERT INTO reviews (item_id, reviewed_at, result, box_before, box_after, session_id, answer_given, free_practice)
         VALUES ($1, $2, $3, $4, $4, $5, $6, true)
         ON CONFLICT (item_id, reviewed_at) DO NOTHING`,
        [item_id, reviewed_at, result, box, session_id ?? null, answer_given ?? null],
      );
      await client.query("COMMIT");
      res.json({ mode: "drill", box });
      return;   // no Hermes: a drill makes no SRS progress
    }
```

In the scheduled path's `INSERT INTO reviews`, replace `free_practice ?? false` with `false`. Update the comment above `Body` accordingly.

- [ ] **Step 5: `countIntroducedToday`**

In `server/src/services/daily-budget.ts` add `AND free_practice = false` to the `countIntroducedToday` WHERE clause and replace its long comment's "Free-practice rows DO count here…" paragraphs with:

```ts
// Drill rows (free_practice) are excluded: a drill never creates review_state,
// so a drilled new card is still new and introduces nothing. Historical
// free-practice rows (skill-row practice before 2026-11) did introduce cards,
// but only today's rows matter here.
```

Also update `readReviewedToday`'s comment: "Free-practice rows are drills — practice chosen outside the day's plan."

- [ ] **Step 6: Run tests**

Same command as Step 3. Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add shared/src/types.ts server/src/routes/reviews.ts server/src/routes/reviews.test.ts server/src/services/daily-budget.ts server/src/services/daily-budget.test.ts
git commit -m "fix(reviews): drill mode logs history but never moves the schedule"
```

---

### Task 4: Focus — queue filters, tagged-first new cards, drill queue

**Files:**
- Modify: `shared/src/types.ts` (`Focus`, `DrillQueueResponse`, `StartSessionRequest.tag_filter`)
- Create: `server/src/services/focus.ts`, `server/src/services/focus.test.ts`
- Modify: `server/src/services/session-plan.ts` (+ test), `server/src/services/queue.ts`, `server/src/routes/queue.ts`, `server/src/routes/sessions.ts`
- Test: `server/src/routes/queue.test.ts`, `server/src/routes/sessions.test.ts`

**Interfaces:**
- Consumes: `tags`, `item_tags` (Task 1); `tagExists(id)` (Task 2).
- Produces:
  - shared `Focus = { skill?: Skill; tag?: uuid }`; `DrillQueueResponse = { items: ItemRecord[] }`; `StartSessionRequest.tag_filter?: uuid`.
  - `parseFocus(query: Record<string, unknown>): Promise<{ ok: true; focus: Focus } | { ok: false; status: 400 | 404; body: { error: string; code: string } }>`
  - `focusClause(focus: Focus, firstParam: number, alias?: string): { sql: string; params: unknown[] }` — returns `""`/`[]` for an empty focus; `sql` starts with ` AND `.
  - `hasFocus(focus: Focus): boolean`
  - `DRILL_UNTAGGED_CAP = 50`, `drillLimit(focus: Focus): number | null` in `session-plan.ts`.
  - `buildQueue({ limit, focus, tz })`, `buildDrill(focus): Promise<ItemRecord[]>` in `queue.ts`.

- [ ] **Step 1: Shared**

```ts
// ----- Focus -----
// Optional narrowing of a review session: at most one skill and one tag.
export const Focus = z.object({
  skill: Skill.optional(),
  tag: z.string().uuid().optional(),
});
export type Focus = z.infer<typeof Focus>;

export const DrillQueueResponse = z.object({ items: z.array(ItemRecord) });
export type DrillQueueResponse = z.infer<typeof DrillQueueResponse>;
```

Add `tag_filter: z.string().uuid().optional(),` to `StartSessionRequest`.

- [ ] **Step 2: Failing pure tests**

```ts
// server/src/services/focus.test.ts
import { describe, it, expect } from "vitest";
import { focusClause, hasFocus } from "./focus.js";

const TAG = "11111111-1111-1111-1111-111111111111";

describe("focusClause", () => {
  it("is empty for no focus", () => {
    expect(focusClause({}, 1)).toEqual({ sql: "", params: [] });
  });
  it("filters skill and tag with consecutive params", () => {
    const c = focusClause({ skill: "kanji", tag: TAG }, 3);
    expect(c.params).toEqual(["kanji", TAG]);
    expect(c.sql).toContain("i.skill = $3");
    expect(c.sql).toContain("ft.tag_id = $4");
  });
  it("honours a custom alias", () => {
    expect(focusClause({ skill: "vocab" }, 1, "x").sql).toContain("x.skill = $1");
  });
});

describe("hasFocus", () => {
  it("is false for {} and true for either part", () => {
    expect(hasFocus({})).toBe(false);
    expect(hasFocus({ skill: "grammar" })).toBe(true);
    expect(hasFocus({ tag: TAG })).toBe(true);
  });
});
```

Append to `server/src/services/session-plan.test.ts`:

```ts
import { drillLimit, DRILL_UNTAGGED_CAP } from "./session-plan.js";

describe("drillLimit", () => {
  it("caps a skill-only focus and leaves a tagged focus uncapped", () => {
    expect(drillLimit({ skill: "kanji" })).toBe(DRILL_UNTAGGED_CAP);
    expect(DRILL_UNTAGGED_CAP).toBe(50);
    expect(drillLimit({ tag: "11111111-1111-1111-1111-111111111111" })).toBeNull();
    expect(drillLimit({ skill: "kanji", tag: "11111111-1111-1111-1111-111111111111" })).toBeNull();
  });
});
```

Run (cwd `server/`): `npx vitest run src/services/focus.test.ts src/services/session-plan.test.ts` — Expected: FAIL (module/exports missing).

- [ ] **Step 3: Implement `focus.ts` and `drillLimit`**

```ts
// server/src/services/focus.ts
// One definition of "what a focus selects", shared by the queue, the dashboard
// and the library so the hero, the session and Library can never disagree
// about which cards a focus covers.
import { Focus, type Focus as FocusT } from "@nihongo/shared";
import { tagExists } from "./tags.js";

export function hasFocus(f: FocusT): boolean {
  return f.skill !== undefined || f.tag !== undefined;
}

export function focusClause(f: FocusT, firstParam: number, alias = "i"): { sql: string; params: unknown[] } {
  let sql = "";
  const params: unknown[] = [];
  if (f.skill !== undefined) {
    params.push(f.skill);
    sql += ` AND ${alias}.skill = $${firstParam + params.length - 1}`;
  }
  if (f.tag !== undefined) {
    params.push(f.tag);
    sql += ` AND EXISTS (SELECT 1 FROM item_tags ft WHERE ft.item_id = ${alias}.id AND ft.tag_id = $${firstParam + params.length - 1})`;
  }
  return { sql, params };
}

type FocusError = { ok: false; status: 400 | 404; body: { error: string; code: string } };

// Parses `?skill=&tag=` from a query string. Empty strings mean "not set".
export async function parseFocus(q: Record<string, unknown>): Promise<{ ok: true; focus: FocusT } | FocusError> {
  const raw = {
    skill: typeof q.skill === "string" && q.skill !== "" ? q.skill : undefined,
    tag: typeof q.tag === "string" && q.tag !== "" ? q.tag : undefined,
  };
  const parsed = Focus.safeParse(raw);
  if (!parsed.success) {
    const bad = parsed.error.errors[0]?.path[0];
    return bad === "skill"
      ? { ok: false, status: 400, body: { error: `unsupported skill: ${raw.skill}`, code: "SKILL_UNSUPPORTED" } }
      : { ok: false, status: 400, body: { error: `invalid tag: ${raw.tag}`, code: "BAD_TAG" } };
  }
  if (parsed.data.tag && !(await tagExists(parsed.data.tag))) {
    return { ok: false, status: 404, body: { error: "tag not found", code: "TAG_NOT_FOUND" } };
  }
  return { ok: true, focus: parsed.data };
}
```

In `session-plan.ts`, delete `FREE_PRACTICE_SIZE` and its comment, and add:

```ts
import type { Focus } from "@nihongo/shared";

// Drill ("drill all anyway") deals every card in a focus. A tag is a
// hand-built set — a class list — so it is dealt whole; a skill alone can be
// thousands of cards, so it is sampled.
export const DRILL_UNTAGGED_CAP = 50;

export function drillLimit(focus: Focus): number | null {
  return focus.tag !== undefined ? null : DRILL_UNTAGGED_CAP;
}
```

Run Step 2's command — Expected: PASS.

- [ ] **Step 4: Failing queue route tests**

In `server/src/routes/queue.test.ts`: delete every test that uses `free=1` (the free-practice block). Extend `insertItem` with `tags?: string[]` (tag ids) and `createdMinutesAgo?: number`:

```ts
  // inside insertItem, after the INSERT … RETURNING id:
  if (opts.createdMinutesAgo !== undefined) {
    await pool.query(`UPDATE items SET created_at = now() - make_interval(mins => $2) WHERE id = $1`, [id, opts.createdMinutesAgo]);
  }
  for (const tagId of opts.tags ?? []) {
    await pool.query(`INSERT INTO item_tags (tag_id, item_id) VALUES ($1, $2)`, [tagId, id]);
  }
```

Add helper and tests:

```ts
async function makeTag(name: string): Promise<string> {
  const r = await pool.query(`INSERT INTO tags (name) VALUES ($1) RETURNING id`, [name]);
  return r.rows[0].id;
}
const get = (qs: string) => request(app).get(`/api/queue?tz=UTC${qs}`).set("X-Passcode", PASSCODE);

describe("focus", () => {
  it("filters due and new by skill × tag", async () => {
    const coto = await makeTag("Coto Academy");
    const hit = await insertItem({ skill: "kanji", tags: [coto] });
    await insertItem({ skill: "kanji" });                    // right skill, no tag
    await insertItem({ skill: "vocab", tags: [coto] });      // right tag, wrong skill
    const res = await get(`&skill=kanji&tag=${coto}`);
    expect(res.status).toBe(200);
    expect([...res.body.due, ...res.body.new].map((i: { id: string }) => i.id)).toEqual([hit]);
  });

  it("introduces tagged new cards before older untagged ones", async () => {
    const coto = await makeTag("Coto Academy");
    const old = await insertItem({ createdMinutesAgo: 1000 });
    const tagged = await insertItem({ createdMinutesAgo: 1, tags: [coto] });
    const res = await get("");
    expect(res.body.new.map((i: { id: string }) => i.id)).toEqual([tagged, old]);
  });

  it("404s an unknown tag and 400s a malformed one", async () => {
    expect((await get("&tag=00000000-0000-0000-0000-000000000000")).body.code).toBe("TAG_NOT_FOUND");
    expect((await get("&tag=nope")).status).toBe(400);
  });
});

describe("drill", () => {
  it("requires a focus", async () => {
    const res = await get("&mode=drill");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FOCUS_REQUIRED");
  });

  it("deals every card in a tag regardless of schedule, excluding suspended", async () => {
    const coto = await makeTag("Coto Academy");
    const fresh = await insertItem({ tags: [coto] });
    const notDue = await insertItem({ tags: [coto], box: 4, nextReviewMinutesAgo: -10_000 });
    const suspended = await insertItem({ tags: [coto], box: 1 });
    await pool.query(`UPDATE review_state SET suspended = true WHERE item_id = $1`, [suspended]);
    const res = await get(`&mode=drill&tag=${coto}`);
    expect(res.body.items.map((i: { id: string }) => i.id).sort()).toEqual([fresh, notDue].sort());
  });

  it("caps a skill-only drill at 50", async () => {
    await pool.query(
      `INSERT INTO items (skill, prompt, answer, source)
       SELECT 'kanji', '{"character":"日"}', '{"meanings":["sun"],"on":[],"kun":[],"stroke_count":4}', 'seed'
         FROM generate_series(1, 60)`,
    );
    const res = await get("&mode=drill&skill=kanji");
    expect(res.body.items).toHaveLength(50);
  });
});
```

Check `insertItem`'s `nextReviewMinutesAgo` semantics: a negative value puts `next_review_at` in the future. If the helper computes it differently, adjust the `notDue` line so its `next_review_at` is ~a week ahead.

Run (cwd `server/`): `DATABASE_URL=… PASSCODE=test npx vitest run src/routes/queue.test.ts` — Expected: new tests FAIL.

- [ ] **Step 5: Implement in `queue.ts`**

Replace `fetchNew`, `fetchDue`, `buildQueue`, `buildFreeQueue` with:

```ts
import type { Focus, ItemRecord } from "@nihongo/shared";
import { focusClause } from "./focus.js";
import { drillLimit } from "./session-plan.js";

const SELECT_ITEM = `SELECT i.id, i.skill, i.prompt, i.answer, i.source, i.tags, i.created_at FROM items i`;

// Brand-new items. Tagged first — a tag is the learner saying "this matters
// now" (class material) — then oldest first, so a deck is worked in order and
// a big imported backlog can't bury what was just added for class.
async function fetchNew(focus: Focus, limit: number): Promise<ItemRecord[]> {
  if (limit <= 0) return [];
  const f = focusClause(focus, 2);
  const res = await pool.query<Row>(
    `${SELECT_ITEM}
       LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE rs.item_id IS NULL ${f.sql}
      ORDER BY EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id) DESC, i.created_at ASC
      LIMIT $1`,
    [limit, ...f.params],
  );
  return res.rows.map(toRecord);
}

// A random sample of currently-due, non-suspended items.
async function fetchDue(focus: Focus, limit: number): Promise<ItemRecord[]> {
  if (limit <= 0) return [];
  const f = focusClause(focus, 2);
  const res = await pool.query<Row>(
    `${SELECT_ITEM}
       JOIN review_state rs ON rs.item_id = i.id
      WHERE rs.next_review_at <= now() AND rs.suspended = false ${f.sql}
      ORDER BY random()
      LIMIT $1`,
    [limit, ...f.params],
  );
  return res.rows.map(toRecord);
}

export async function buildQueue(
  opts: { limit: number; focus: Focus; tz: string },
): Promise<{ due: ItemRecord[]; new: ItemRecord[] }> {
  // Session size comes from the global daily budget via the shared planner —
  // a focus narrows which cards are dealt, never how many the day allows.
  const budget = await getDailyBudget(opts.tz);
  const introducedToday = await countIntroducedToday(opts.tz);
  const { sessionCap, newLimit } = planSession(budget, introducedToday, opts.limit);
  if (sessionCap <= 0) return { due: [], new: [] };

  // New first, so when new cards run short due fills the whole cap.
  // `sessionSize` models this same ordering.
  const neu = await fetchNew(opts.focus, newLimit);
  const due = await fetchDue(opts.focus, sessionCap - neu.length);
  return { due, new: neu };
}

// Drill: every non-suspended card in the focus, shuffled, schedule ignored.
// Grading uses mode "drill", which leaves review_state alone.
export async function buildDrill(focus: Focus): Promise<ItemRecord[]> {
  const f = focusClause(focus, 1);
  const cap = drillLimit(focus);
  const res = await pool.query<Row>(
    `${SELECT_ITEM}
       LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE COALESCE(rs.suspended, false) = false ${f.sql}
      ORDER BY random()
      ${cap === null ? "" : `LIMIT ${cap}`}`,
    f.params,
  );
  return res.rows.map(toRecord);
}
```

Also export a count used by the dashboard (Task 5):

```ts
export async function countDrill(focus: Focus): Promise<number> {
  const f = focusClause(focus, 1);
  const r = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM items i LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE COALESCE(rs.suspended, false) = false ${f.sql}`,
    f.params,
  );
  const n = r.rows[0]?.c ?? 0;
  const cap = drillLimit(focus);
  return cap === null ? n : Math.min(n, cap);
}
```

- [ ] **Step 6: Route**

Replace `server/src/routes/queue.ts` body:

```ts
import { Router } from "express";
import { buildQueue, buildDrill } from "../services/queue.js";
import { DEFAULT_QUEUE_LIMIT } from "../services/session-plan.js";
import { parseFocus, hasFocus } from "../services/focus.js";
import { resolveTz } from "../services/tz.js";

export const queueRouter = Router();

queueRouter.get("/", async (req, res) => {
  const parsed = await parseFocus(req.query);
  if (!parsed.ok) { res.status(parsed.status).json(parsed.body); return; }
  const { focus } = parsed;

  // Drill ("drill all anyway") needs a focus: drilling the entire deck is not
  // a session anyone means to start.
  if (req.query.mode === "drill") {
    if (!hasFocus(focus)) {
      res.status(400).json({ error: "drill needs a skill or tag", code: "FOCUS_REQUIRED" });
      return;
    }
    res.json({ items: await buildDrill(focus) });
    return;
  }

  const limit = Math.min(Math.max(Number(req.query.limit ?? DEFAULT_QUEUE_LIMIT), 1), 500);
  const tz = resolveTz(req.query.tz);
  res.json(await buildQueue({ limit, focus, tz }));
});
```

- [ ] **Step 7: Sessions record the tag**

In `server/src/routes/sessions.ts` change `StartBody` to `z.object({ skill_filter: z.string().optional(), tag_filter: z.string().uuid().optional() })` and insert both:

```ts
  const { skill_filter, tag_filter } = parsed.data;
  const r = await pool.query(
    `INSERT INTO sessions (skill_filter, tag_filter) VALUES ($1, $2) RETURNING id`,
    [skill_filter ?? null, tag_filter ?? null],
  );
```

Add to `server/src/routes/sessions.test.ts` (adapt to its helpers):

```ts
  it("records a tag filter", async () => {
    const t = await pool.query(`INSERT INTO tags (name) VALUES ('X') RETURNING id`);
    const res = await auth(request(app).post("/api/sessions")).send({ tag_filter: t.rows[0].id });
    const s = await pool.query(`SELECT tag_filter FROM sessions WHERE id = $1`, [res.body.id]);
    expect(s.rows[0].tag_filter).toBe(t.rows[0].id);
  });
```

- [ ] **Step 8: Run tests**

Run (cwd `server/`): `DATABASE_URL=… PASSCODE=test npx vitest run src/routes/queue.test.ts src/routes/sessions.test.ts src/services/focus.test.ts src/services/session-plan.test.ts`
Expected: all pass. Then `npm --workspace server run build` (tsc) — fix any remaining `FREE_PRACTICE_SIZE`/`buildFreeQueue` references the compiler reports (only `dashboard.ts` should remain; handled in Task 5 — if tsc blocks, do Task 5 Step 3 first).

- [ ] **Step 9: Commit**

```bash
git add shared/src/types.ts server/src/services server/src/routes/queue.ts server/src/routes/queue.test.ts server/src/routes/sessions.ts server/src/routes/sessions.test.ts
git commit -m "feat(queue): skill/tag focus, tagged-first new cards, drill queue"
```

---

### Task 5: Focus-aware dashboard

**Files:**
- Modify: `shared/src/types.ts` (`DashboardResponse.drill_available`)
- Modify: `server/src/routes/dashboard.ts`
- Test: `server/src/routes/dashboard.test.ts`

**Interfaces:**
- Consumes: `parseFocus`, `focusClause` (Task 4), `countDrill` (Task 4).
- Produces: `GET /api/dashboard?skill=&tag=&tz=` and `POST /api/dashboard/round?skill=&tag=&tz=` — `session_size` and `another_round_size` computed for the focus; new `drill_available: number` (0 when no focus); `by_skill` stays unfocused.

- [ ] **Step 1: Shared**

Add to `DashboardResponse`:

```ts
  // How many cards "Drill all anyway" would deal for the requested focus
  // (capped like the drill queue). Always 0 without a focus.
  drill_available: z.number().int().nonnegative(),
```

- [ ] **Step 2: Failing tests**

Append to `server/src/routes/dashboard.test.ts` (it must mount both routers to compare; if it only mounts the dashboard, mount the queue router too: `a.use("/api/queue", queueRouter)`). Reuse/extend its item helper with `skill` and `tags` like Task 4:

```ts
describe("focus", () => {
  async function tag(name: string) {
    return (await pool.query(`INSERT INTO tags (name) VALUES ($1) RETURNING id`, [name])).rows[0].id as string;
  }

  it("hero session_size equals what the focused queue deals, for each focus shape", async () => {
    const coto = await tag("Coto Academy");
    for (let n = 0; n < 4; n++) await insertItem({ skill: "kanji", tags: [coto] });
    for (let n = 0; n < 3; n++) await insertItem({ skill: "kanji" });
    for (let n = 0; n < 5; n++) await insertItem({ skill: "vocab", tags: [coto] });
    for (const qs of ["&skill=kanji", `&tag=${coto}`, `&skill=kanji&tag=${coto}`, ""]) {
      const d = await auth(request(app).get(`/api/dashboard?tz=UTC${qs}`));
      const q = await auth(request(app).get(`/api/queue?tz=UTC${qs}`));
      expect(d.body.session_size, qs).toBe(q.body.due.length + q.body.new.length);
    }
  });

  it("reports drill_available for a focus and 0 without one", async () => {
    const coto = await tag("Coto Academy");
    for (let n = 0; n < 3; n++) await insertItem({ skill: "kanji", tags: [coto] });
    expect((await auth(request(app).get(`/api/dashboard?tz=UTC&tag=${coto}`))).body.drill_available).toBe(3);
    expect((await auth(request(app).get(`/api/dashboard?tz=UTC`))).body.drill_available).toBe(0);
  });

  it("keeps by_skill unfocused", async () => {
    const coto = await tag("Coto Academy");
    await insertItem({ skill: "kanji", tags: [coto] });
    await insertItem({ skill: "vocab" });
    const d = await auth(request(app).get(`/api/dashboard?tz=UTC&tag=${coto}`));
    expect(d.body.by_skill.vocab.new).toBe(1);
  });

  it("404s an unknown tag", async () => {
    const d = await auth(request(app).get(`/api/dashboard?tz=UTC&tag=00000000-0000-0000-0000-000000000000`));
    expect(d.status).toBe(404);
  });
});
```

Run: `DATABASE_URL=… PASSCODE=test npx vitest run src/routes/dashboard.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

In `server/src/routes/dashboard.ts`:
- `buildPayload(tz, budget, focus: Focus)`.
- Keep the two per-skill queries as they are (unfocused `by_skill`).
- Replace the `totalNew`/`totalDue` derivation with focused counts:

```ts
  // The hero models the session the client will ask for — the same focus,
  // through the same filter the queue uses.
  const f = focusClause(focus, 1);
  const pools = await pool.query<{ new: number; due: number }>(
    `SELECT count(*) FILTER (WHERE rs.item_id IS NULL)::int AS new,
            count(*) FILTER (WHERE rs.next_review_at <= now() AND rs.suspended = false)::int AS due
       FROM items i LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE true ${f.sql}`,
    f.params,
  );
  const available = { new: pools.rows[0]?.new ?? 0, due: pools.rows[0]?.due ?? 0 };
```

- Add `drill_available: hasFocus(focus) ? await countDrill(focus) : 0` to the returned object.
- Both handlers parse the focus first:

```ts
dashboardRouter.get("/", async (req, res) => {
  const parsed = await parseFocus(req.query);
  if (!parsed.ok) { res.status(parsed.status).json(parsed.body); return; }
  const tz = resolveTz(req.query.tz);
  res.json(await buildPayload(tz, await getDailyBudget(tz), parsed.focus));
});

dashboardRouter.post("/round", async (req, res) => {
  const parsed = await parseFocus(req.query);
  if (!parsed.ok) { res.status(parsed.status).json(parsed.body); return; }
  const tz = resolveTz(req.query.tz);
  res.json(await buildPayload(tz, await unlockRound(tz), parsed.focus));
});
```

Imports: `parseFocus, focusClause, hasFocus` from `../services/focus.js`; `countDrill` from `../services/queue.js`; `type Focus` from `@nihongo/shared`. Update the comment above `available` ("Mixed practice sends no skill…") to say the pools are counted for the requested focus.

- [ ] **Step 4: Run the whole server suite**

Run (repo root): `DATABASE_URL=… PASSCODE=test npm --workspace server test` and `npm --workspace server run build`
Expected: all pass, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add shared/src/types.ts server/src/routes/dashboard.ts server/src/routes/dashboard.test.ts
git commit -m "feat(dashboard): hero, rounds and drill count follow the focus"
```

---

### Task 6: Library API — filtered, paged, with user tags

**Files:**
- Modify: `shared/src/types.ts` (`LibraryResponse`; delete `LibrarySkillGroup`)
- Modify: `server/src/routes/library.ts`
- Test: `server/src/routes/library.test.ts`

**Interfaces:**
- Consumes: `parseFocus`, `focusClause` (Task 4), `userTagsSql` (Task 2).
- Produces: `GET /api/library?q=&skill=&tag=&offset=` → `LibraryResponse = { items: LibraryItem[]; total: number; next_offset: number | null }`, `LIBRARY_PAGE = 50`.

- [ ] **Step 1: Shared**

Replace `LibrarySkillGroup` and `LibraryResponse` with:

```ts
// One page of the Library, filtered by an optional search, skill and tag.
// Newest first (newest-tagged first when filtering by tag).
export const LibraryResponse = z.object({
  items: z.array(LibraryItem),
  total: z.number().int().nonnegative(),
  next_offset: z.number().int().nonnegative().nullable(),
});
export type LibraryResponse = z.infer<typeof LibraryResponse>;
```

- [ ] **Step 2: Failing tests**

Replace the body of `server/src/routes/library.test.ts`'s describe blocks (keep its app setup/helpers; extend the item helper with `tags` as in Task 4):

```ts
describe("GET /api/library", () => {
  it("pages 50 at a time with next_offset", async () => {
    await pool.query(
      `INSERT INTO items (skill, prompt, answer, source)
       SELECT 'vocab', jsonb_build_object('sentence_ruby','w','target','語'||g,'sentence_english','w'),
              '{"meaning":"m","reading":"r"}', 'seed' FROM generate_series(1, 55) g`,
    );
    const p1 = await auth(request(app).get("/api/library"));
    expect(p1.body.items).toHaveLength(50);
    expect(p1.body.total).toBe(55);
    expect(p1.body.next_offset).toBe(50);
    const p2 = await auth(request(app).get("/api/library?offset=50"));
    expect(p2.body.items).toHaveLength(5);
    expect(p2.body.next_offset).toBeNull();
  });

  it("filters by search, skill and tag and returns user_tags", async () => {
    const coto = (await pool.query(`INSERT INTO tags (name) VALUES ('Coto Academy') RETURNING id`)).rows[0].id;
    const water = await insertVocab("水", "water", [coto]);
    await insertVocab("火", "fire");
    const r = await auth(request(app).get(`/api/library?q=wat&skill=vocab&tag=${coto}`));
    expect(r.body.items.map((i: { id: string }) => i.id)).toEqual([water]);
    expect(r.body.items[0].user_tags).toEqual([{ id: coto, name: "Coto Academy" }]);
  });

  it("404s an unknown tag", async () => {
    expect((await auth(request(app).get(`/api/library?tag=00000000-0000-0000-0000-000000000000`))).status).toBe(404);
  });
});
```

(`insertVocab(target, meaning, tagIds = [])` — add tag inserts to the file's helper.)

Run: `DATABASE_URL=… PASSCODE=test npx vitest run src/routes/library.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `server/src/routes/library.ts`:

```ts
import { Router } from "express";
import type { Skill, TagRef } from "@nihongo/shared";
import { pool } from "../db/pool.js";
import { itemDisplay, boxToMastery } from "../services/item-display.js";
import { parseFocus, focusClause } from "../services/focus.js";
import { userTagsSql } from "../services/tags.js";

export const libraryRouter = Router();

export const LIBRARY_PAGE = 50;

type Row = { id: string; skill: Skill; prompt: unknown; answer: unknown; box: number | null; user_tags: TagRef[]; total: number };

// GET /api/library?q=&skill=&tag=&offset= — one page of cards for Library.
// Search is a case-insensitive substring over the stored prompt/answer JSON
// (known-naive; better search is a separate piece of work).
libraryRouter.get("/", async (req, res) => {
  const parsed = await parseFocus(req.query);
  if (!parsed.ok) { res.status(parsed.status).json(parsed.body); return; }
  const { focus } = parsed;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const offset = Math.max(0, Math.floor(Number(req.query.offset ?? 0)) || 0);

  const params: unknown[] = [LIBRARY_PAGE, offset];
  let search = "";
  if (q) { params.push(q); search = ` AND (i.prompt::text ILIKE '%' || $3 || '%' OR i.answer::text ILIKE '%' || $3 || '%')`; }
  const f = focusClause(focus, params.length + 1);
  params.push(...f.params);
  const order = focus.tag
    ? `(SELECT ot.added_at FROM item_tags ot WHERE ot.item_id = i.id AND ot.tag_id = $${params.length}) DESC, i.created_at DESC`
    : `i.created_at DESC`;

  const r = await pool.query<Row>(
    `SELECT i.id, i.skill, i.prompt, i.answer, rs.box, ${userTagsSql("i")} AS user_tags,
            count(*) OVER ()::int AS total
       FROM items i LEFT JOIN review_state rs ON rs.item_id = i.id
      WHERE true ${search} ${f.sql}
      ORDER BY ${order}
      LIMIT $1 OFFSET $2`,
    params,
  );

  const total = r.rows[0]?.total ?? 0;
  res.json({
    items: r.rows.map((row) => {
      const d = itemDisplay(row.skill, row.prompt, row.answer);
      return { id: row.id, skill: row.skill, front: d.front, reading: d.reading, meaning: d.meaning,
               mastery: boxToMastery(row.box), user_tags: row.user_tags };
    }),
    total,
    next_offset: offset + r.rows.length < total ? offset + r.rows.length : null,
  });
});
```

Note: `order` references the tag param, which is the **last** param only when `focus.tag` is set — `focusClause` pushes the tag after the skill, so `$${params.length}` is the tag. Keep that invariant.

When `offset` is past the end, `r.rows` is empty and `total` would read 0. Add a test for `?offset=500` expecting `items: []` and `next_offset: null`; `total` 0 there is acceptable (the client only pages forward from a real `next_offset`).

- [ ] **Step 4: Run tests + commit**

Run: `DATABASE_URL=… PASSCODE=test npm --workspace server test` — Expected: all pass.

```bash
git add shared/src/types.ts server/src/routes/library.ts server/src/routes/library.test.ts
git commit -m "feat(library): paged library filtered by search, skill and tag"
```

---

### Task 7: Client — focus state, API hooks, practice modes

**Files:**
- Create: `client/src/lib/focus.ts`
- Modify: `client/src/api-hooks.ts`
- Modify: `client/src/screens/PracticeScreen.tsx`
- Create: `client/src/components/FocusPickers.tsx`

**Interfaces:**
- Consumes: shared `Focus`, `TagSummary`, `DrillQueueResponse`, `DashboardResponse`, `LibraryResponse`, `ReviewMode`, tag request/response types.
- Produces:
  - `loadFocus(): Focus`, `saveFocus(f: Focus): void`, `focusQuery(f: Focus): URLSearchParams`, `focusLabel(f: Focus, tags: TagSummary[]): string | null`, `sanitizeFocus(f: Focus, tags: TagSummary[]): Focus` (drops a tag id not in `tags`).
  - api-hooks: `fetchQueue(focus)`, `fetchDrill(focus)`, `fetchDashboard(focus)`, `unlockAnotherRound(focus)`, `startSession(focus)`, `submitReview({...; mode?})`, `fetchLibrary({ q?, skill?, tag?, offset? })`, `fetchTags()`, `createTag(body)`, `updateTag(id, body)`, `deleteTag(id)`, `tagItem(tagId, itemId)`, `untagItem(tagId, itemId)`, `previewQuickAdd(body)`, `quickAddToTag(tagId, body)`, `searchTagCandidates(tagId, q, skill?)`.
  - `<PracticeScreen focus={Focus} mode={"scheduled" | "drill"} onDone />`
  - `<FocusPickers focus tags onChange />` — two labelled `<select>`s ("Skill", "Tag").

- [ ] **Step 1: `client/src/lib/focus.ts`**

```ts
import type { Focus, TagSummary } from "@nihongo/shared";
import { SKILL_META } from "./skills";

const KEY = "nihongo.focus";

// Remembered per device until cleared. Storage can be missing or throw
// (private mode, blocked site data), so every access is guarded and the
// fallback is "no focus".
export function loadFocus(): Focus {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as Focus;
    return { ...(v.skill ? { skill: v.skill } : {}), ...(v.tag ? { tag: v.tag } : {}) };
  } catch {
    return {};
  }
}

export function saveFocus(f: Focus): void {
  try {
    if (!f.skill && !f.tag) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(f));
  } catch { /* storage unavailable — focus just won't persist */ }
}

// A remembered tag may have been deleted since; drop it rather than 404.
export function sanitizeFocus(f: Focus, tags: TagSummary[]): Focus {
  if (f.tag && !tags.some((t) => t.id === f.tag)) {
    const { tag: _gone, ...rest } = f;
    return rest;
  }
  return f;
}

export function focusQuery(f: Focus): URLSearchParams {
  const p = new URLSearchParams();
  if (f.skill) p.set("skill", f.skill);
  if (f.tag) p.set("tag", f.tag);
  return p;
}

// "Kanji × Coto Academy", "Kanji", "Coto Academy", or null for no focus.
export function focusLabel(f: Focus, tags: TagSummary[]): string | null {
  const parts: string[] = [];
  if (f.skill) parts.push(SKILL_META[f.skill].label);
  if (f.tag) parts.push(tags.find((t) => t.id === f.tag)?.name ?? "Tag");
  return parts.length ? parts.join(" × ") : null;
}
```

- [ ] **Step 2: api-hooks**

In `client/src/api-hooks.ts`:
- Replace `fetchQueue`:

```ts
export function fetchQueue(focus: Focus): Promise<QueueResponse> {
  const p = focusQuery(focus);
  p.set("tz", browserTz());
  return api<QueueResponse>(`/api/queue?${p.toString()}`);
}

// Every card in the focus, schedule ignored ("drill all anyway").
export function fetchDrill(focus: Focus): Promise<DrillQueueResponse> {
  const p = focusQuery(focus);
  p.set("mode", "drill");
  return api<DrillQueueResponse>(`/api/queue?${p.toString()}`);
}
```

Move `browserTz` above `fetchQueue`.
- `fetchDashboard(focus: Focus)` and `unlockAnotherRound(focus: Focus)`: build the query with `focusQuery(focus)` + `tz`.
- `startSession(focus: Focus)`: body `{ skill_filter: focus.skill, tag_filter: focus.tag }` (drop the old `?? "vocab"` default — the column is nullable).
- `submitReview` input: replace `free_practice?: boolean` with `mode?: ReviewMode`; return type `Promise<ReviewStateResponse | DrillReviewResponse>`.
- `fetchLibrary(opts: { q?: string; skill?: Skill; tag?: string; offset?: number })` → `/api/library?…` built with `URLSearchParams`, skipping empty values.
- Replace the `// ----- Study lists -----` block with:

```ts
// ----- Tags -----
export const fetchTags = () => api<TagsResponse>("/api/tags");
export const createTag = (body: CreateTagRequest) =>
  api<CreateTagResponse>("/api/tags", { method: "POST", body: JSON.stringify(body) });
export const updateTag = (id: string, body: UpdateTagRequest) =>
  api<void>(`/api/tags/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteTag = (id: string) => api<void>(`/api/tags/${id}`, { method: "DELETE" });
export const tagItem = (tagId: string, itemId: string) =>
  api<void>(`/api/tags/${tagId}/items/${itemId}`, { method: "PUT" });
export const untagItem = (tagId: string, itemId: string) =>
  api<void>(`/api/tags/${tagId}/items/${itemId}`, { method: "DELETE" });
export const previewQuickAdd = (body: QuickAddPreviewRequest) =>
  api<QuickAddPreviewResponse>("/api/tags/preview", { method: "POST", body: JSON.stringify(body) });
export const quickAddToTag = (tagId: string, body: QuickAddItemRequest) =>
  api<QuickAddItemResponse>(`/api/tags/${tagId}/quick-add`, { method: "POST", body: JSON.stringify(body) });
export function searchTagCandidates(tagId: string, q: string, skill?: string): Promise<TagCandidatesResponse> {
  const p = new URLSearchParams({ q });
  if (skill) p.set("skill", skill);
  return api<TagCandidatesResponse>(`/api/tags/${tagId}/candidates?${p.toString()}`);
}
```

Check how `api()` handles a 204 (empty body) — read its implementation at the top of the file. If it always calls `res.json()`, make it return `undefined` when `res.status === 204` (the old `deleteStudyList` already returned `void`, so this likely exists).

Update the imports from `@nihongo/shared` accordingly and import `focusQuery` from `./lib/focus`.

- [ ] **Step 3: PracticeScreen**

Change `Props` and loading:

```ts
type Props = {
  onDone: () => void;
  focus: Focus;                       // {} = everything
  mode: "scheduled" | "drill";        // drill: every card in the focus, schedule untouched
};

export function PracticeScreen({ onDone, focus, mode }: Props) {
  // …state unchanged…
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (mode === "drill") {
          const { items: drill } = await fetchDrill(focus);
          if (cancelled) return;
          sessionIdRef.current = null;
          setItems(drill);
          setPhase(drill.length === 0 ? "empty" : "reviewing");
          return;
        }
        const [{ id }, queue] = await Promise.all([startSession(focus), fetchQueue(focus)]);
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
  }, [focus.skill, focus.tag, mode]);
```

In `handleAnswerWithText` replace the `free_practice:` line and its comment with:

```ts
      // A drill is logged but never moves a card's schedule (server-side).
      mode,
```

Empty-state copy: `{mode === "drill" ? "Nothing to drill here." : "Nothing due here."}`, sub-copy `"Add or tag some cards in Library."` for drill, existing copy otherwise; button always "Back to Today". The summary's primary button (currently `{listId ? "Back to list" : "Back to Today"}`) becomes plain `Back to Today`. Remove the `fetchStudyCram` import and every remaining `listId`/`free` reference.

- [ ] **Step 4: FocusPickers**

```tsx
// client/src/components/FocusPickers.tsx
import type { Focus, Skill, TagSummary } from "@nihongo/shared";
import { SKILL_ORDER, SKILL_META } from "../lib/skills";

type Props = { focus: Focus; tags: TagSummary[]; onChange: (f: Focus) => void };

// The two optional narrowing controls shared by Today's hero and Library.
export function FocusPickers({ focus, tags, onChange }: Props) {
  return (
    <div className="focus-pickers">
      <label className="focus-pickers__field">
        <span className="focus-pickers__label">Skill</span>
        <select
          className="focus-pickers__select"
          value={focus.skill ?? ""}
          onChange={(e) => onChange({ ...focus, skill: (e.target.value || undefined) as Skill | undefined })}
        >
          <option value="">All</option>
          {SKILL_ORDER.map((s) => <option key={s} value={s}>{SKILL_META[s].label}</option>)}
        </select>
      </label>
      <label className="focus-pickers__field">
        <span className="focus-pickers__label">Tag</span>
        <select
          className="focus-pickers__select"
          value={focus.tag ?? ""}
          onChange={(e) => onChange({ ...focus, tag: e.target.value || undefined })}
        >
          <option value="">All</option>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.item_count})</option>)}
        </select>
      </label>
    </div>
  );
}
```

Add styles to the stylesheet that holds `.today__hero` (find it with `grep -rn "today__hero" client/src/styles`), tokens only:

```css
.focus-pickers { display: flex; gap: var(--space-2, 8px); margin-top: var(--space-3, 12px); }
.focus-pickers__field { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.focus-pickers__label { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3, var(--muted)); }
.focus-pickers__select { min-height: 44px; width: 100%; border-radius: var(--radius-2, 10px); border: 1px solid var(--line); background: var(--paper); color: var(--ink); padding: 0 10px; font: inherit; }
```

Replace every fallback with the real token names from `client/src/styles/README.md` / the tokens file (read it first; do not ship fallbacks to undefined tokens).

- [ ] **Step 5: Typecheck**

Run: `npm run build` (repo root). Expected: client errors only in `App.tsx`, `DashboardScreen.tsx`, Study screens, `BrowseScreen.tsx`, `ItemDetailSheet.tsx` — fixed in Tasks 8–9. Commit once those compile (end of Task 8).

---

### Task 8: Client — Today hero focus, drill fallback, App wiring

**Files:**
- Modify: `client/src/App.tsx`, `client/src/screens/DashboardScreen.tsx`, `client/src/components/BottomTabs.tsx`

**Interfaces:**
- Consumes: Task 7 exports.
- Produces: `App` owns `focus` state (`useState(loadFocus)`, persisted with `saveFocus` in an effect) and `tags` (fetched on auth). `DashboardScreen` props: `{ focus, tags, onFocusChange(f), onPractice(mode), onOpenSettings, onStartLesson, onOpenLessons }`. `Tab` = `"today" | "lessons" | "library" | "stats"`.

- [ ] **Step 1: App**

- `Route = Tab | "settings" | "lesson" | "practice"`; delete `studyListId`, `practiceSkill`; add:

```ts
  const [focus, setFocus] = useState<Focus>(loadFocus);
  const [practiceMode, setPracticeMode] = useState<"scheduled" | "drill">("scheduled");
  const [tags, setTags] = useState<TagSummary[]>([]);
  const refreshTags = useCallback(() => {
    fetchTags().then((r) => {
      setTags(r.tags);
      setFocus((f) => sanitizeFocus(f, r.tags));
    }).catch(() => {});
  }, []);
  useEffect(() => { if (authState === "authed") refreshTags(); }, [authState, refreshTags]);
  useEffect(() => { saveFocus(focus); }, [focus]);
```

(Hooks must sit above the early returns for `checking`/`needs-auth`.)
- Today: `<DashboardScreen focus={focus} tags={tags} onFocusChange={setFocus} onPractice={(mode) => { setPracticeMode(mode); setRoute("practice"); }} … />`
- Practice: `<PracticeScreen focus={focus} mode={practiceMode} onDone={() => setRoute("today")} />`
- Library: `<LibraryScreen tags={tags} onTagsChanged={refreshTags} onReviewTag={(id) => { setFocus({ tag: id }); setRoute("today"); }} />` (component built in Task 9; until then import will fail — do Task 9 Step 2 before typechecking).
- Remove the `study`, `study-detail`, `cram` branches and imports; `fullBleed = route === "practice" || route === "settings" || route === "lesson"`; `showTabs = !fullBleed`; `tab = route === "settings" || route === "lesson" || route === "practice" ? "today" : route`.

- [ ] **Step 2: BottomTabs**

`export type Tab = "today" | "lessons" | "library" | "stats";` and the third entry `{ id: "library", label: "Library", icon: <IconStudy /> }`.

- [ ] **Step 3: DashboardScreen**

- Props as above. `load` depends on `focus`: `fetchDashboard(focus)`; `useEffect(() => { load(); }, [load])` with `useCallback(..., [focus.skill, focus.tag])`. On a 404 (`err.message` includes "tag not found" — check how `api()` surfaces error bodies and match on the `TAG_NOT_FOUND` code if available), call `onFocusChange({ ...focus, tag: undefined })` instead of showing the error.
- `anotherRound` → `unlockAnotherRound(focus)`.
- `const label = focusLabel(focus, tags);`
- Inside `<section className="today__hero" ref={heroRef}>` (add `const heroRef = useRef<HTMLElement>(null)`), render **first** in every state:

```tsx
        <FocusPickers focus={focus} tags={tags} onChange={onFocusChange} />
        {label && (
          <button type="button" className="focus-chip" onClick={() => onFocusChange({})} aria-label={`Clear focus ${label}`}>
            {label} <span aria-hidden="true">×</span>
          </button>
        )}
```

- Add a focused-empty state **before** the existing four, used when `label && data.session_size === 0`:

```tsx
        {label && data.session_size === 0 ? (
          <>
            <p className="today__hero-label">Ready to review</p>
            <p className="today__hero-count">0</p>
            <p className="today__hero-done-sub">Nothing due in {label}.</p>
            {data.drill_available > 0 && (
              <button type="button" className="cta cta--primary cta--lg today__hero-cta" onClick={() => onPractice("drill")}>
                Drill all {data.drill_available} anyway
              </button>
            )}
            {roundButton}
          </>
        ) : pool === 0 ? ( /* …existing states unchanged… */
```

- Happy state copy: sub-line `{label ? <>cards · {label}</> : <>cards across all skills &nbsp;·&nbsp; <span className="jp">混合練習</span></>}`; button `{label ? "Start focused practice" : "Start mixed practice"}` with `onClick={() => onPractice("scheduled")}`.
- Skill rows: `onClick={() => { onFocusChange({ ...focus, skill: s }); heroRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}`.
- Styles (tokens only, next to `.focus-pickers`):

```css
.focus-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; margin-top: var(--space-2, 8px); padding: 0 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--paper); color: var(--ink); font: inherit; }
```

- [ ] **Step 4: Typecheck after Task 9 Step 2, then commit Tasks 7–8 together**

Run: `npm run build`. Expected: clean.

```bash
git add client/src
git commit -m "feat(client): focus pickers on Today, drill fallback, practice modes"
```

---

### Task 9: Client — Library tab and tags on the card sheet

**Files:**
- Create: `client/src/screens/LibraryScreen.tsx`
- Create: `client/src/components/AddCards.tsx` (QuickAdd + SearchAdd moved from `StudyListDetailScreen.tsx`)
- Modify: `client/src/components/ItemDetailSheet.tsx`
- Delete: `client/src/screens/StudyScreen.tsx`, `client/src/screens/StudyListDetailScreen.tsx`, `client/src/screens/BrowseScreen.tsx`

**Interfaces:**
- Consumes: Task 7 hooks, `FocusPickers`, `ConfirmDelete` (moved from `StudyListDetailScreen.tsx` into `client/src/components/ConfirmDelete.tsx`).
- Produces: `<LibraryScreen tags onTagsChanged onReviewTag(tagId) />`; `<AddCards tagId onChanged />`; `ItemDetailSheet` props `{ itemId, onClose, tags?: TagSummary[], onTagsChanged?: () => void }` (the old `onRemove` prop is removed).

- [ ] **Step 1: Move the add flows**

```bash
git mv client/src/screens/StudyListDetailScreen.tsx client/src/components/AddCards.tsx
```

In `AddCards.tsx`: delete `StudyListDetailScreen`, `MemberRow` and the pagination/type-group code; move `ConfirmDelete` into its own `client/src/components/ConfirmDelete.tsx` (export it, props unchanged). Keep `SearchAdd`, `QuickAdd`, `Labeled`, then apply these renames throughout: `listId` → `tagId`; `searchStudyCandidates` → `searchTagCandidates`; `addStudyItem(listId, itemId)` → `tagItem(tagId, itemId)`; `previewStudyItem` → `previewQuickAdd`; `quickAddStudyItem` → `quickAddToTag`; `QuickAddStudyItemRequest` → `QuickAddItemRequest`; `StudyPreviewResponse` → `QuickAddPreviewResponse`; button text "Add to list" → "Add to tag". Export a wrapper:

```tsx
export function AddCards({ tagId, onChanged }: { tagId: string; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<"search" | "quick">("quick");
  return (
    <section className="study-detail__add">
      <div role="tablist" className="study-detail__add-tabs">
        <button type="button" role="tab" aria-selected={mode === "quick"} onClick={() => setMode("quick")}>Quick-add new</button>
        <button type="button" role="tab" aria-selected={mode === "search"} onClick={() => setMode("search")}>Search &amp; add</button>
      </div>
      {mode === "quick" ? <QuickAdd tagId={tagId} onChanged={onChanged} /> : <SearchAdd tagId={tagId} onChanged={onChanged} />}
    </section>
  );
}
```

Match the tab markup/classes to what `StudyListDetailScreen` rendered around lines 180–195 (read it with `git show HEAD:client/src/screens/StudyListDetailScreen.tsx | sed -n 175,200p`) so existing styles still apply.

- [ ] **Step 2: LibraryScreen**

```tsx
// client/src/screens/LibraryScreen.tsx
import { useCallback, useEffect, useState } from "react";
import type { Focus, LibraryItem, TagSummary } from "@nihongo/shared";
import { fetchLibrary, createTag, updateTag, deleteTag } from "../api-hooks";
import { FocusPickers } from "../components/FocusPickers";
import { AddCards } from "../components/AddCards";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { ItemDetailSheet } from "../components/ItemDetailSheet";
import { SKILL_META } from "../lib/skills";
import { IconSearch } from "../components/icons";

type Props = {
  tags: TagSummary[];
  onTagsChanged: () => void;
  onReviewTag: (tagId: string) => void;
};

// Everything in the deck, searchable and filterable by skill and tag. Tags are
// managed here: create, rename, add cards, delete (label only).
export function LibraryScreen({ tags, onTagsChanged, onReviewTag }: Props) {
  const [filter, setFilter] = useState<Focus>({});
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);

  const load = useCallback(async (offset = 0) => {
    const r = await fetchLibrary({ q: q.trim() || undefined, ...filter, offset });
    setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
    setTotal(r.total);
    setNextOffset(r.next_offset);
  }, [q, filter]);

  useEffect(() => { void load(0); }, [load]);

  const refreshAll = useCallback(async () => { onTagsChanged(); await load(0); }, [onTagsChanged, load]);
  const activeTag = tags.find((t) => t.id === filter.tag) ?? null;

  async function submitNewTag(e: React.FormEvent) {
    e.preventDefault();
    setTagError(null);
    try {
      const { id } = await createTag({ name: newTag.trim() });
      setNewTag("");
      onTagsChanged();
      setFilter({ ...filter, tag: id });
    } catch (err) {
      setTagError(err instanceof Error ? err.message : "couldn't create tag");
    }
  }

  return (
    <main className="screen library">
      <h1 className="lessons__title">Library</h1>

      <div className="browse__search">
        <IconSearch />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vocab, grammar, kanji…" aria-label="Search library" />
      </div>
      <FocusPickers focus={filter} tags={tags} onChange={setFilter} />

      {activeTag ? (
        <TagHeader
          tag={activeTag}
          onReview={() => onReviewTag(activeTag.id)}
          onRenamed={onTagsChanged}
          onDeleted={() => { setFilter({ ...filter, tag: undefined }); onTagsChanged(); }}
          onCardsChanged={refreshAll}
        />
      ) : (
        <section className="library__tags">
          <h2 className="today__section-title">Your tags</h2>
          <ul className="lessons__list">
            {tags.map((t) => (
              <li key={t.id} className="lessons__item">
                <button type="button" className="lessons__item-btn" onClick={() => setFilter({ ...filter, tag: t.id })}>
                  <span className="lessons__item-title">{t.name}</span>
                  <span className="lessons__item-meta">{t.item_count} cards · {Math.round(t.avg_mastery * 100)}%</span>
                </button>
              </li>
            ))}
          </ul>
          <form className="lessons__form" onSubmit={submitNewTag}>
            <label className="settings__field">
              <span className="settings__field-label">New tag</span>
              <input className="settings__input" placeholder="e.g. Coto Academy" maxLength={60}
                     value={newTag} onChange={(e) => setNewTag(e.target.value)} />
            </label>
            {tagError && <p role="alert" className="muted">{tagError}</p>}
            <button type="submit" className="cta cta--primary cta--block" disabled={!newTag.trim()}>Create tag</button>
          </form>
        </section>
      )}

      <h2 className="today__section-title">{total} card{total === 1 ? "" : "s"}</h2>
      <ul className="library__list">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" className="library__row" onClick={() => setOpenItem(it.id)}>
              <span className="library__row-front">{it.front}{it.reading && <span className="browse__item-reading">{it.reading}</span>}</span>
              <span className="library__row-meaning">{SKILL_META[it.skill].short} · {it.meaning}</span>
              <span className="library__row-tags">{it.user_tags.map((t) => <span key={t.id} className="tag-pill">{t.name}</span>)}</span>
              <span className="browse__item-bar"><span className="browse__item-bar-fill" style={{ width: `${Math.round(it.mastery * 100)}%` }} /></span>
            </button>
          </li>
        ))}
      </ul>
      {nextOffset !== null && (
        <button type="button" className="cta cta--block" onClick={() => void load(nextOffset)}>Load more</button>
      )}

      {openItem && (
        <ItemDetailSheet itemId={openItem} tags={tags} onClose={() => setOpenItem(null)} onTagsChanged={refreshAll} />
      )}
    </main>
  );
}

function TagHeader({ tag, onReview, onRenamed, onDeleted, onCardsChanged }: {
  tag: TagSummary; onReview: () => void; onRenamed: () => void; onDeleted: () => void; onCardsChanged: () => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(tag.name);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    try {
      await updateTag(tag.id, { name: name.trim() });
      setRenaming(false);
      setError(null);
      onRenamed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "rename failed");
    }
  }

  return (
    <section className="library__tag-header">
      {renaming ? (
        <form onSubmit={saveName} className="lessons__form">
          <label className="settings__field">
            <span className="settings__field-label">Tag name</span>
            <input className="settings__input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          {error && <p role="alert" className="muted">{error}</p>}
          <button type="submit" className="cta cta--primary" disabled={!name.trim()}>Save</button>
        </form>
      ) : (
        <h2 className="library__tag-name">{tag.name}
          <button type="button" className="linkbtn" onClick={() => setRenaming(true)}>Rename</button>
        </h2>
      )}
      {tag.description && <p className="muted">{tag.description}</p>}
      <button type="button" className="cta cta--primary cta--block" onClick={onReview} disabled={tag.item_count === 0}>
        Review this tag
      </button>
      <button type="button" className="cta cta--block" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
        Add cards
      </button>
      {adding && <AddCards tagId={tag.id} onChanged={onCardsChanged} />}
      <button type="button" className="linkbtn confirm__destructive" onClick={() => setConfirming(true)}>Delete tag</button>
      {confirming && (
        <ConfirmDelete
          /* match ConfirmDelete's existing prop names; copy: */
          title={`Delete “${tag.name}”?`}
          body="This removes the label only. The cards and your progress on them are kept."
          onCancel={() => setConfirming(false)}
          onConfirm={async () => { await deleteTag(tag.id); setConfirming(false); onDeleted(); }}
        />
      )}
    </section>
  );
}
```

Adapt the `ConfirmDelete` props to its real signature (read it after the move in Step 1); if it hard-codes list copy, add `title`/`body` props.

Styles (tokens only), in the same stylesheet as `.browse__*`:

```css
.library__list { list-style: none; margin: 0; padding: 0; }
.library__row { display: grid; grid-template-columns: 1fr; gap: 2px; width: 100%; min-height: 44px; padding: 10px 0; text-align: left; background: none; border: 0; border-bottom: 1px solid var(--line); color: var(--ink); font: inherit; }
.library__row-meaning { color: var(--ink-2, var(--muted)); font-size: 14px; }
.library__row-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.tag-pill { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--paper-2, var(--line)); color: var(--ink); }
.library__tag-name { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
```

Replace fallbacks with real token names from the tokens file.

- [ ] **Step 3: ItemDetailSheet tags**

Replace the `onRemove` prop with `tags?: TagSummary[]; onTagsChanged?: () => void;`, delete the "Remove from this list" button, and render below `<Progress …/>`:

```tsx
            {tags && <ItemTags detail={detail} tags={tags} onChanged={async () => {
              setDetail(await fetchItem(itemId));
              onTagsChanged?.();
            }} />}
```

```tsx
function ItemTags({ detail, tags, onChanged }: { detail: ItemDetailResponse; tags: TagSummary[]; onChanged: () => Promise<void> }) {
  const available = tags.filter((t) => !detail.user_tags.some((u) => u.id === t.id));
  return (
    <section className="item-detail__tags" aria-label="Tags">
      <h3 className="item-detail__section-title">Tags</h3>
      <div className="library__row-tags">
        {detail.user_tags.map((t) => (
          <button key={t.id} type="button" className="tag-pill" aria-label={`Remove tag ${t.name}`}
                  onClick={async () => { await untagItem(t.id, detail.id); await onChanged(); }}>
            {t.name} ×
          </button>
        ))}
        {detail.user_tags.length === 0 && <span className="muted">No tags</span>}
      </div>
      {available.length > 0 && (
        <label className="focus-pickers__field">
          <span className="focus-pickers__label">Add tag</span>
          <select className="focus-pickers__select" value=""
                  onChange={async (e) => { if (e.target.value) { await tagItem(e.target.value, detail.id); await onChanged(); } }}>
            <option value="">Choose…</option>
            {available.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      )}
    </section>
  );
}
```

`.tag-pill` used as a button needs `min-height: 44px` there: add `.item-detail__tags .tag-pill { min-height: 44px; border: 0; font: inherit; }`. If `item-detail__section-title` doesn't exist, reuse the class `Progress` uses for its heading.

- [ ] **Step 4: Delete old screens, typecheck, run all unit tests**

```bash
git rm client/src/screens/StudyScreen.tsx client/src/screens/BrowseScreen.tsx
npm run build
DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo PASSCODE=test npm test
```

Expected: build clean (remove any remaining `fetchStudy*`/`StudyList*` references the compiler reports); all unit/server tests pass. Also `grep -rn "study-list\|StudyList\|free_practice: \|buildFreeQueue\|FREE_PRACTICE_SIZE" client/src server/src shared/src` → no hits outside migrations/comments explaining history.

- [ ] **Step 5: Commit**

```bash
git add -A client/src
git commit -m "feat(client): Library tab with tag management; tags on the card sheet"
```

---

### Task 10: E2E — fixtures and specs

**Files:**
- Rename: `e2e/tests/fixtures/seed-test-study.sql` → `e2e/tests/fixtures/seed-test-tags.sql`
- Modify: `e2e/tests/fixtures.ts`, `e2e/tests/helpers.ts`, every `*.sql` fixture that truncates `study_lists`
- Rename/replace: `e2e/tests/study.spec.ts` → `e2e/tests/library.spec.ts`
- Create: `e2e/tests/focus.spec.ts`

**Interfaces:**
- Consumes: the running app (`npm run dev:e2e`, `NIHONGO_FAKE_AI=1`) with the migrated local DB.
- Produces: `loadFixture("seed-test-tags")`; helper `practiceSkill(page, skill)` now sets focus and starts the focused session.

- [ ] **Step 1: Fixtures**

```bash
git mv e2e/tests/fixtures/seed-test-study.sql e2e/tests/fixtures/seed-test-tags.sql
grep -ln study_list e2e/tests/fixtures/*.sql
```

In every listed file replace `study_lists` with `tags` in `TRUNCATE`. In `seed-test-tags.sql`: `INSERT INTO study_lists (id, title, description)` → `INSERT INTO tags (id, name, description)` with name `'Long list'`; `INSERT INTO study_list_items (list_id, item_id, position) SELECT …` → `INSERT INTO item_tags (tag_id, item_id) SELECT '1111…', id FROM …` (drop the position expression). Add a second tag for focus tests, with two kanji items tagged and one vocab item tagged:

```sql
INSERT INTO tags (id, name, description)
VALUES ('22222222-2222-2222-2222-222222222222', 'Coto Academy', '');
INSERT INTO item_tags (tag_id, item_id)
SELECT '22222222-2222-2222-2222-222222222222', id FROM items WHERE external_id IN ('study-long-kanji', 'study-001');
```

In `fixtures.ts` replace `"seed-test-study"` with `"seed-test-tags"` in the union.

- [ ] **Step 2: Helper**

```ts
// Focus Today's hero on one skill by tapping its row, then start that focused
// (budgeted) session. Rows keep `.skill-card--<skill>` as a stable hook.
export async function practiceSkill(page: Page, skill: string): Promise<void> {
  await page.locator(`.skill-card--${skill}`).click();
  await page.getByRole("button", { name: /Start focused practice/ }).click();
}
```

- [ ] **Step 3: `library.spec.ts`**

```ts
import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login } from "./helpers";

test.beforeEach(() => { loadFixture("seed-test-tags"); });

test("library: create tag → quick-add → search-add → shows in tag", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByPlaceholder("e.g. Coto Academy").fill("Week 5");
  await page.getByRole("button", { name: "Create tag" }).click();
  await expect(page.getByRole("heading", { name: /Week 5/ })).toBeVisible();

  await page.getByRole("button", { name: "Add cards" }).click();
  await page.getByRole("tab", { name: /Quick-add new/ }).click();
  await page.getByPlaceholder(/Word/).fill("test");
  await page.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("button", { name: "Add to tag" }).click();

  await page.getByRole("tab", { name: /Search & add/ }).click();
  await page.getByPlaceholder("Search your cards…").fill("fire");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).first().click();

  await expect(page.locator(".library__row-front", { hasText: "テスト" })).toBeVisible();
  await expect(page.locator(".library__row-front", { hasText: "火" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "2 cards" })).toBeVisible();
});

test("library: tag a card from its sheet, then untag it", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByLabel("Search library").fill("water");
  await page.locator(".library__row").first().click();
  const sheet = page.getByRole("dialog", { name: "Card detail" });
  await sheet.getByLabel("Add tag").selectOption({ label: "Long list" });
  await expect(sheet.getByRole("button", { name: "Remove tag Long list" })).toBeVisible();
  await sheet.getByRole("button", { name: "Remove tag Long list" }).click();
  await expect(sheet.getByRole("button", { name: "Remove tag Long list" })).toBeHidden();
});

test("library: Load more pages a long tag; Review this tag focuses Today", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: /Long list/ }).click();
  await expect(page.getByRole("heading", { name: "26 cards" })).toBeVisible();
  await page.getByRole("button", { name: "Review this tag" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Clear focus Long list/ })).toBeVisible();
});

test("library: deleting a tag keeps its cards", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: /Long list/ }).click();
  await page.getByRole("button", { name: "Delete tag" }).click();
  await page.getByRole("button", { name: /Delete/ }).last().click();
  await expect(page.getByRole("button", { name: /Long list/ })).toBeHidden();
  await page.getByLabel("Search library").fill("word 1");
  await expect(page.locator(".library__row").first()).toBeVisible();
});
```

26 cards < 50, so "Load more" isn't exercised by this fixture; that's covered by the server paging test. Rename the third test to "Review this tag focuses Today" accordingly.

- [ ] **Step 4: `focus.spec.ts`**

```ts
import { test, expect } from "@playwright/test";
import { loadFixture } from "./fixtures";
import { login, POST_GRADE } from "./helpers";

test.beforeEach(() => { loadFixture("seed-test-tags"); });

test("focus: skill × tag narrows the hero and the dealt cards", async ({ page }) => {
  await login(page);
  await page.getByLabel("Skill").selectOption({ label: "Kanji" });
  await page.getByLabel("Tag").selectOption({ label: "Coto Academy (2)" });
  await expect(page.getByText(/cards · Kanji × Coto Academy/)).toBeVisible();
  await expect(page.locator(".today__hero-count")).toHaveText("1");
  await page.getByRole("button", { name: "Start focused practice" }).click();
  await expect(page.locator(".practice-bar")).toBeVisible();
});

test("focus: empty focus offers drill, and drilling leaves the box unchanged", async ({ page }) => {
  await login(page);
  // Vocab × Coto Academy is one card (水). Introduce it through a focused session.
  await page.getByLabel("Skill").selectOption({ label: "Vocab" });
  await page.getByLabel("Tag").selectOption({ label: "Coto Academy (2)" });
  await page.getByRole("button", { name: "Start focused practice" }).click();
  await page.getByRole("button", { name: /Tap to reveal/i }).click();
  await page.getByRole("button", { name: /Got it/i }).click();
  await page.getByRole("button", { name: "Back to Today" }).click();

  // Nothing left in the focus → drill fallback.
  await expect(page.getByText("Nothing due in Vocab × Coto Academy.")).toBeVisible();
  await page.getByRole("button", { name: "Drill all 1 anyway" }).click();
  await page.getByRole("button", { name: /Tap to reveal/i }).click();
  await page.getByRole("button", { name: /Got it/i }).click();
  await page.getByRole("button", { name: "Back to Today" }).click();

  // The drill did not touch the schedule: still box 1 after exactly one review.
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByLabel("Search library").fill("water");
  await page.locator(".library__row").first().click();
  await expect(page.getByRole("dialog", { name: "Card detail" }).getByText(/Box 1 of 5 · 1 review ·/)).toBeVisible();
});

test("focus: tapping a skill row sets the focus and persists across reload", async ({ page }) => {
  await login(page);
  await page.locator(".skill-card--vocab").click();
  await expect(page.getByRole("button", { name: /Clear focus Vocab/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /Clear focus Vocab/ })).toBeVisible();
  await page.getByRole("button", { name: /Clear focus Vocab/ }).click();
  await expect(page.getByText(/cards across all skills/)).toBeVisible();
});
```

The first test's Kanji × Coto session is only started, not graded (kanji cards use a drawing flow). The drill test uses the vocab flip card, whose grade sequence (Tap to reveal → Got it) matches the old `study.spec.ts`. The progress string comes from `ItemDetailSheet`'s `Progress`: `Box {n} of 5 · {reviews} review(s) · {missed} missed`.

- [ ] **Step 5: Run the whole e2e suite**

```bash
npm run db:up && npm run db:migrate && npm run dev:e2e   # separate terminal / background
DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo E2E_BASE_URL=http://localhost:5173 E2E_PASSCODE=test npm run e2e
```

(Use the base URL the dev script serves the client on; CLAUDE.md shows `:3001` for a prod-style build.) Expected: all specs pass. Skill specs (`grammar`, `particle`, `kanji`, …) now run budgeted focused sessions; if one expected more cards than the daily new share (10 at target 30), raise `app_settings.daily_review_target` in that spec's fixture rather than weakening the assertion.

- [ ] **Step 6: Commit**

```bash
git add -A e2e
git commit -m "test(e2e): library and focus specs; fixtures use tags"
```

---

### Task 11: Pre-deploy check, deploy, live validation

**Files:** none (operations). Requires the owner's go-ahead for the production read.

- [ ] **Step 1: Read production list data (owner approval required)**

Ask the owner to approve, or to run themselves:

```bash
ssh spruce-cedar.exe.xyz 'cd ~/nihongo-practice && set -a && . ./.env && set +a && psql "$DATABASE_URL" -c "SELECT title, lower(btrim(title)) AS key, count(item_id) FROM study_lists l LEFT JOIN study_list_items i ON i.list_id = l.id GROUP BY l.id ORDER BY key"'
```

Expected: list names and counts. Any repeated `key` will be merged by the migration — confirm with the owner that merging those is right before deploying.

- [ ] **Step 2: Full local verification**

```bash
npm run build
DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo PASSCODE=test npm test
```

Expected: clean build, all tests pass (paste counts into the report).

- [ ] **Step 3: Deploy the branch**

```bash
bash scripts/deploy.sh
ssh spruce-cedar.exe.xyz 'curl -s http://localhost:3001/healthz'
```

Expected: `{"ok":true}`. The script's final `healthz returned HTTP 307` line is expected (private share).

- [ ] **Step 4: Live check through the tunnel (read-only)**

Start the tunnel as a background task: `ssh -o ExitOnForwardFailure=yes -N -L 3101:localhost:3001 spruce-cedar.exe.xyz`; confirm `curl -s http://localhost:3101/healthz`. With the Playwright MCP browser: resize 390×844, open `http://localhost:3101`, log in with the prod passcode, then screenshot:
1. Today with no focus (hero copy unchanged, pickers present);
2. Today focused on the Coto Academy tag (hero count, clear chip);
3. Library: tag list with counts, the Coto Academy tag header, one card sheet showing its tags.
Read `browser_console_messages` (level `error`). **Do not** start a session, grade, drill, create/rename/delete tags, or tag cards — this is real learner data.

- [ ] **Step 5: Report and stop**

Report test counts, the migration result (tags and counts as shown in Library), screenshots, and console output to the owner. Do **not** open the PR — the owner tests live first, then asks for it.
