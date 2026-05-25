# Phase 3a — Vocab Seed Import (Design)

**Date:** 2026-05-25
**Status:** Approved (design); pending implementation plan

## Goal

Import the owner's existing ~300 Migaku-format vocab cards from `Personal study.xml` into the production database using the existing `seed/` workspace importer, with two small safety additions (dry-run + sample preview) before the real run.

Phase 3a is intentionally narrow: it's the operational task of populating prod with the owner's real vocab study deck. The grammar/reading PDF import is deferred to Phase 3b and is out of scope for this spec.

## Background

The Phase 1 work shipped a complete vocab seed importer in the `seed/` workspace:
- `seed/src/parse-xml.ts` — parses Migaku-style `<deck>/<cards>/<card>` XML with `<japanese>` + `<text name='Meaning'>` fields. Stable `external_id` per card (uses XML `@_id` if present, else a sha1 of the Japanese text).
- `seed/src/import.ts` — orchestrator: parses XML, idempotency-filters against existing `items WHERE source='seed'`, calls `generateSentencesForCards` (from `@nihongo/gen`) in batches of 20 to produce example sentences via Claude, enriches with kuromoji ruby + `readingFor`, inserts via `insertSeedItems`.
- `seed/src/insert.ts` — transactional INSERT with `ON CONFLICT (source, external_id) DO NOTHING`. Returns `{ inserted, skipped }`.

The importer was built in Phase 1 but never run against the iCloud source file — Phase 2 (multi-skill expansion) was prioritized first, so until now the app has been populated entirely by AI generation in prod.

The source file lives at:
- `/Users/michaelgalloway/Library/Mobile Documents/com~apple~CloudDocs/Personal study.xml` (~30 KB, ~300 cards)

It is personal study material and must NOT be checked into git.

## Scope

### In

- Add `--dry-run` CLI flag to `seed/src/import.ts`.
- Add unconditional sample preview (first 5 parsed cards) to `seed/src/import.ts`.
- Add a small CLI integration test covering the `--dry-run` path.
- Operationally: run the importer locally with `DATABASE_URL` pointing at the prod database, dry-run first, then real.
- Verify in the deployed app that new vocab items are reachable.

### Out

- PDF import (Phase 3b).
- Changes to `parse-xml.ts`, `insert.ts`, or `@nihongo/gen` internals.
- Tagging imported items (decided No during brainstorming).
- A "personal" filter in the dashboard or queue (no UX change in 3a).
- Removing or migrating existing AI-generated rows.

## Code Changes

### `seed/src/import.ts`

Add CLI argument parsing for `--dry-run` (positional file path remains the first non-flag arg).

```
usage: tsx src/import.ts [--dry-run] <path-to-deck.xml>
```

Behavior:

1. Parse args. If `--dry-run` is present, set `dryRun = true`.
2. Read + parse XML (existing path).
3. **Sample preview (always — both dry-run and real run):** print `--- sample (first 5 of N) ---` followed by `external_id | japanese | english` for the first 5 parsed cards, then `---`.
4. Connect to DB (existing path) and run the existing idempotency check (`SELECT external_id FROM items WHERE source='seed' AND external_id = ANY(...)`).
5. **Cost estimate (dry-run only):** compute estimated input/output tokens for the remaining batch count using a coarse heuristic — e.g., `input_tokens_per_batch ≈ system_prompt_tokens + cards_per_batch * tokens_per_card`, `output_tokens_per_batch ≈ cards_per_batch * tokens_per_sentence`. Multiply by `INPUT_PER_MTOK` / `OUTPUT_PER_MTOK` from `@nihongo/gen`'s `pricing.js` exports. Print:
   ```
   dry-run: would import N cards in B batches; est. cost ≈ $X.XX
   ```
   The estimate doesn't need to be tight — order-of-magnitude is enough. Exact numbers will land in the implementation plan.
6. **Real run (non-dry-run):** continue with the existing batch loop unchanged.
7. **Exit codes:** dry-run exits 0 after the estimate. Real run exits 0 on success, 1 on any uncaught error, 2 on bad usage (matches existing behavior for missing path arg).

The CLI parsing should be minimal — no external dep added; a hand-rolled flag scan is fine.

### `seed/src/import.test.ts` (NEW, or extend existing test)

Add one test that:
1. Writes a small XML fixture (2-3 cards) to a tmp file.
2. Invokes the dry-run path (either by extracting `main()` logic into a testable function or by exec'ing `tsx src/import.ts --dry-run <fixture>`).
3. Asserts stdout contains the sample header, the parsed count, and the cost-estimate line.
4. Asserts no rows are inserted (query items table count before/after; expect equal).

The exact test shape (in-process refactor vs. exec) is an implementation detail. Pick the simpler one.

## Operational Steps (not committed code, executed during Task 3 of the implementation plan)

These are the actions the owner / Claude executes to actually perform the import. They are listed here so the implementation plan can sequence them, but they do not appear in the commit history.

1. **Get prod `DATABASE_URL` locally.** Either:
   - Read directly from the prod server if prod Postgres listens externally with valid credentials (likely not the default), OR
   - Open an SSH tunnel: `ssh -L 5432:localhost:5432 exedev@spruce-cedar.exe.xyz` and use a local URL like `postgres://...@localhost:5432/...`.
   
   The implementation plan should figure out which is appropriate during execution. Local DB credentials likely live in the prod server's `.env` — fetch them, don't commit them.

2. **Dry-run against prod:**
   ```
   DATABASE_URL=<prod-url> npm --workspace seed run import -- --dry-run "/Users/michaelgalloway/Library/Mobile Documents/com~apple~CloudDocs/Personal study.xml"
   ```
   Expected output: parsed count ≈ 300+, `0 already seeded; ~300 to import`, sample preview, estimated cost in the $1-3 range.

3. **Real run against prod:**
   ```
   DATABASE_URL=<prod-url> ANTHROPIC_API_KEY=<key> npm --workspace seed run import -- "/Users/michaelgalloway/Library/Mobile Documents/com~apple~CloudDocs/Personal study.xml"
   ```
   Importer batches into groups of 20, prints progress + cost per batch. On any batch failure it logs and continues; re-running the command later picks up where it left off (idempotency).

4. **Verify:**
   - `psql "$DATABASE_URL" -c "SELECT source, skill, count(*) FROM items GROUP BY 1,2 ORDER BY 1,2;"` should show a `seed | vocab | ~300` row.
   - Open https://spruce-cedar.exe.xyz, log in, dashboard's Vocab card should show the new items in the "new" bucket count.
   - Practice → first card should render with a generated sentence + kuromoji ruby.

5. **Close the SSH tunnel** if used.

## Testing

- `npm --workspace seed test` — existing parse-xml tests + new dry-run test all pass.
- No new test infra: vitest + tsx already configured in the workspace.
- Manual verification per step 4 above.

## Risks & Mitigations

- **Cost overrun beyond expectations.** Mitigated by dry-run estimate. Worst-case actual is bounded by the number of cards × per-batch Claude call cost (~15 batches × ~$0.10 ≈ $1.50 typical). If dry-run shows >$5 we pause and inspect rather than spend.

- **Existing prod data collisions.** None expected: existing rows are `source='ai'`, new rows are `source='seed'`. The `UNIQUE (source, external_id)` constraint partitions them. `ON CONFLICT DO NOTHING` covers any re-import within the seed source.

- **Per-batch Claude failures.** Existing code catches and continues. Re-running the import is safe.

- **Connection to prod DB.** SSH tunnel approach is safer than exposing prod Postgres externally; the plan defers this decision to execution time but defaults to tunnel.

- **Failed kuromoji ruby on some inputs.** Existing path calls `toRubyHtml` and `readingFor` per card. If a card fails enrichment, the batch loop catches and skips. The unimported card stays available for a later re-run.

## Success Criteria

- `seed/src/import.ts` supports `--dry-run` and prints a sample preview.
- New CLI test passes locally.
- After running the importer against prod, `SELECT count(*) FROM items WHERE source='seed' AND skill='vocab'` returns a number close to the parsed XML card count (allowing for failed batches that will need a re-run).
- The deployed app shows the new vocab items in practice; at least one item plays end-to-end with a sentence + ruby + meaning.

## Out of Scope (deferred to Phase 3b)

- PDF importer for grammar/reading from the JLPT prep book.
- Multi-skill seed import.
- Any UX changes (filters, tags, "personal" toggle, etc.).
