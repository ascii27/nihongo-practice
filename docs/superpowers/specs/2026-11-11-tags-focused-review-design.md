# Tags + focused Ready for Review — design

Date: 2026-11-11 · Branch: `feat/tags-focused-review` · Sub-projects A + B of three
(C, an Anki-style scheduler, gets its own spec next).

## Why

The owner's goal is memorisation that actually sticks, Anki-style. Two things work against it today:

1. **Study lists feel like a separate system.** List members are ordinary `items` with their own
   `review_state`, so they are technically in the SRS — but new cards are introduced oldest-first
   at ~10/day, and 334 older new vocab cards sit ahead of anything added to a list. Coto Academy
   material effectively never reaches Ready for Review; the only way to see it is cram.
2. **Cram corrupts the schedule.** `POST /api/reviews` runs `nextState` for every grade, including
   cram (`free_practice = true`). Cramming a card not due for a week promotes it a box, pushing it
   *further* away — the opposite of what drilling before class should do.

The owner also wants to narrow a review session to an area of focus: a skill (Grammar, Kanji), a
group of content (Coto Academy), or both.

## What the owner asked for

- Study lists are really labels on ordinary content: treat them as **tags**, migrate the data.
- **Ready for Review covers all content**, tagged or not.
- Ready for Review takes an **optional focus**: skill and/or tag, e.g. Kanji × Coto Academy.

## Decisions (owner-approved, 2026-11-11)

| Question | Decision |
|---|---|
| Scope | A (tags) + B (focus) in this spec; C (scheduler) next, separately |
| What a focus deals | SRS first (due + new within the focus); if that is empty, offer a **drill** of everything in the focus that does not touch the schedule |
| Focus vs daily target | A focus is the same budgeted daily session, narrowed. Skill rows on Today set the focus instead of starting free practice |
| New-card order | Tagged cards first, then untagged; oldest first within each group |
| Study tab | Folded into a new **Library** tab (browse/search everything, filter by skill/tag, manage tags) |
| Tag storage | Rename `study_lists` → `tags`, `study_list_items` → `item_tags` |

## 1. Data model and migration

New migration `db/migrations/<epoch-ms>_study_lists_to_tags.sql`:

```sql
ALTER TABLE study_lists RENAME TO tags;
ALTER TABLE tags RENAME COLUMN title TO name;
ALTER TABLE study_list_items RENAME TO item_tags;
ALTER TABLE item_tags RENAME COLUMN list_id TO tag_id;
ALTER TABLE item_tags DROP COLUMN position;
ALTER INDEX study_list_items_list_idx RENAME TO item_tags_tag_idx;
CREATE INDEX item_tags_item_idx ON item_tags (item_id);
-- after merging duplicates (below):
CREATE UNIQUE INDEX tags_name_lower_idx ON tags (lower(btrim(name)));
```

Constraint and primary-key names are renamed to match (`item_tags_pkey`, FK names) so later
migrations read sensibly.

- `tags`: `id`, `name`, `description`, `created_at`. Names are unique case-insensitively, after
  trimming.
- `item_tags`: `tag_id`, `item_id`, `added_at`; PK `(tag_id, item_id)`. `position` is dropped —
  there is no hand-ordering within a tag; Library sorts by `added_at DESC`.
- Every list becomes a tag with the same id, name, description and members. An item in several
  lists ends up with several tags.
- **Duplicate titles**: before the unique index is created, lists whose trimmed, lower-cased titles
  collide are merged into the earliest-created one: members are unioned (keeping the earliest
  `added_at` per item), and the others are deleted. The migration is a single transaction.
  Production data is checked before deploy (see *Pre-deploy check*).
- `items.tags text[]` is untouched. It keeps holding internal `lesson:<uuid>` labels written by
  `lesson-generate.ts` and is never shown as a user tag.
- `server/src/db/reset.ts`: `TRUNCATE` list uses `tags`, `item_tags`.

### Drill no longer touches the schedule

`POST /api/reviews` body: `free_practice?: boolean` is replaced by
`mode: "scheduled" | "drill"` (default `"scheduled"`) in `shared/src/types.ts`.

- `scheduled`: unchanged — `nextState`, upsert `review_state`, log the review with
  `free_practice = false`.
- `drill`: no `review_state` read-modify-write. The review is logged with `free_practice = true`,
  `box_before = box_after =` the current box (0 if the card has never been studied). The response
  reports the unchanged state.
- A brand-new card drilled **stays new**: no `review_state` row is created, so it still gets its
  proper first showing in a scheduled session.
- `countIntroducedToday` excludes `free_practice` rows. (Today it counts them because cram did
  introduce cards; under this design a drill introduces nothing.) `readReviewedToday` already
  excludes them.
- **Hermes**: drill reviews are not emitted. `review_logged` describes SRS progress for Eva, and a
  drill makes none. The event shape is unchanged, so `scripts/hermes-type.mjs` needs no update and
  no admin key is required. Streak milestone detection still runs only for scheduled reviews.
- Historical `free_practice` rows are left alone: skill-row practice did advance the schedule when
  it ran, so rewriting history would be wrong.

After this change, drill is the only review mode outside the daily target.

## 2. Focused Ready for Review

### Focus

`Focus = { skill?: Skill; tag?: uuid }` — at most one skill and one tag, both optional. Defined once
in `shared/src/types.ts` and parsed by every route that takes one.

### Queue

`GET /api/queue?skill=&tag=` — the budgeted session, as today, narrowed by the focus.

- Allowance and the new-card share stay **global** (`getDailyBudget`, `countIntroducedToday`,
  `planSession` unchanged). A focus narrows which cards are dealt, not how many the day allows.
- `fetchNew` / `fetchDue` take the focus. Tag filter:
  `AND ($tag::uuid IS NULL OR EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id AND t.tag_id = $tag))`.
- `fetchNew` order, focused or not:
  `ORDER BY EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id) DESC, i.created_at ASC`.
- Unknown skill → 400 `SKILL_UNSUPPORTED` (as today); malformed or unknown tag → 400 / 404
  `TAG_NOT_FOUND`.

`GET /api/queue?mode=drill&skill=&tag=` — the drill.

- Requires a focus (at least one of skill/tag), else 400 `FOCUS_REQUIRED`.
- Every item matching the focus, `ORDER BY random()`, excluding suspended items. Capped at 50 when
  no tag is given (a skill alone can be thousands of cards); uncapped with a tag, so a whole class
  list can be drilled.
- Response: `DrillQueueResponse = { items: ItemRecord[] }` (the shape cram returns today); the
  client plays it with the same practice engine.

Removed: `?free=1`, `buildFreeQueue`, `FREE_PRACTICE_SIZE`, `GET /api/study-lists/:id/cram`.

### Dashboard

`GET /api/dashboard?skill=&tag=` computes the hero number for that focus through the same
`planSession` + `sessionSize`, against `available` pools counted with the same focus filters, so
the hero and the session it starts cannot disagree. It also reports, for the focus:

- `drill_available`: count of cards a drill would deal (for "Drill all N anyway");
- whether another round would yield cards (existing `previewRound` logic, now focus-aware).

Per-skill rows keep their unfocused due/new counts.

### Sessions

`POST /api/sessions` keeps `skill_filter`; a nullable `tag_filter uuid` column is added to
`sessions` in the same migration so session history records the whole focus.

### Today screen (client)

- Under the hero number, a **Focus** row: **Skill [All ▾]** and **Tag [All ▾]** pickers (tags
  listed with card counts). Hero number and button copy follow the focus — e.g. "12 cards ·
  Kanji × Coto Academy".
- When a focus is set, a **× clear** chip is shown on the hero.
- When the focused session is empty: "Nothing due in Kanji · Coto Academy" with
  **Drill all N anyway** (when N > 0) and **Go another round** (when a round would yield cards).
- Tapping a skill row sets the hero focus's skill (keeping any tag) and scrolls to the hero; it no
  longer starts a separate practice.
- The focus is remembered per device in `localStorage` (wrapped in try/catch; falls back to no
  focus) until cleared.
- `PracticeScreen` takes `{ focus, mode: "scheduled" | "drill" }` instead of `{ skill, free }`, and
  grades with the matching `mode`.

## 3. Library tab

Bottom tabs become **Today · Lessons · Library · Stats** (`Tab` union: `study` → `library`).

### API

- `GET /api/library?q=&skill=&tag=&offset=` — replaces the grouped-by-skill payload. Returns
  `{ items: LibraryItem[], total, next_offset | null }`, 50 per page, newest first (`added_at DESC`
  for a tag filter, `created_at DESC` otherwise). `LibraryItem` gains `tags: {id, name}[]`.
  Search stays the existing case-insensitive substring match over prompt/answer JSON.
- `/api/study-lists/*` → `/api/tags/*`:
  - `GET /api/tags` — `{ id, name, description, item_count, avg_mastery, created_at }[]`
  - `POST /api/tags` — create `{ name, description? }`; 409 `TAG_EXISTS` on a case-insensitive
    name clash
  - `PATCH /api/tags/:id` — rename / edit description; same 409
  - `DELETE /api/tags/:id` — removes the tag and its `item_tags` rows only; items and their review
    state are kept
  - `PUT /api/tags/:id/items/:itemId`, `DELETE /api/tags/:id/items/:itemId` — tag / untag
    (idempotent)
  - `POST /api/tags/preview`, `POST /api/tags/:id/quick-add` — today's AI preview + quick-add,
    unchanged except that the new item is tagged instead of listed
- `GET /api/items/:id` (`ItemDetailResponse`) gains `tags: {id, name}[]`.

Schemas in `shared/src/types.ts` are renamed (`StudyList*` → `Tag*`). Client and server ship
together, so no compatibility routes.

### Screens

- **Library** (grows out of the unused `BrowseScreen`): search box; the same Skill/Tag pickers as
  the hero (one shared `FocusPickers` component); with no tag filter, a **Your tags** section (count,
  average mastery, **+ New tag**); then the paged card list (front, reading, meaning, mastery bar,
  tag pills, **Load more**).
- **With a tag selected**: a header with name, description and **Rename**; **Review this tag**
  (→ Today with focus `{ tag }`); **Add cards** (today's quick-add and search & add, moved from
  `StudyListDetailScreen`); **Delete tag** via the existing in-app confirm sheet, worded "removes
  the label; cards and progress are kept".
- **`ItemDetailSheet`** gains a **Tags** section: current tags as removable pills, plus an add-tag
  picker. This is how bulk-deck cards get tagged.

Removed: `StudyScreen`, `StudyListDetailScreen` (subcomponents move to Library), the `study`,
`study-detail` and `cram` routes in `App.tsx`.

## Testing

- **Unit (pure)**: `planSession` / `sessionSize` with focused pools; drill cap rule.
- **Server (real Postgres)**:
  - migration: lists → tags with members preserved; duplicate titles merged; unique name index.
  - reviews: `mode: "drill"` leaves `review_state` untouched (existing and brand-new cards), logs
    `free_practice = true`, emits no Hermes event; `countIntroducedToday` ignores drill rows.
  - queue: skill, tag and skill × tag filters; tagged-first new ordering; drill requires a focus,
    caps at 50 without a tag, excludes suspended; unknown tag → 404.
  - dashboard: hero count matches the queue for each focus combination; `drill_available`.
  - tags CRUD, case-insensitive clash, delete keeps items + state; library filters and paging.
- **E2E** (`iphone-14`): focus pickers change the hero and the dealt cards; empty focus offers drill
  and drilling leaves the box unchanged; skill row sets focus; create tag → quick-add → appears in
  Library; tag a card from `ItemDetailSheet`; **Review this tag** lands on a focused Today.
  `study.spec.ts` is rewritten as `library.spec.ts`; fixtures renamed to the new tables.
- **Live**: deploy the branch, check through the SSH tunnel with Playwright at 390×844, then the
  owner tests before the PR opens.

## Pre-deploy check

Before deploying, read production `study_lists` (names, member counts, duplicate titles after
trim/lower-casing) so the migration's merge behaviour is confirmed against real data. Needs the
owner's go-ahead — the read was blocked by the permission classifier during design.

## Out of scope

- Sub-project C: in-session relearning, Again/Hard/Good/Easy, per-card intervals (next spec).
- Better search (still the naive substring match).
- Multi-select focus (several skills or tags at once); bulk "tag all results".
