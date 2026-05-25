# Phase 3a — Vocab Seed Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--dry-run` and an always-on sample preview to the existing vocab seed importer, then operationally import the owner's ~300 Migaku vocab cards into the production database.

**Architecture:** Refactor `seed/src/import.ts` from a single monolithic `main()` into small pure helpers (`parseArgs`, `formatSamplePreview`, `estimateCost`) plus a dependency-injected orchestrator `run(argv, deps)`. Production wiring (Postgres pool + Claude generation) lives in `main()`, which only executes when the file is run directly. This makes the dry-run path testable in-process with no Postgres and no Anthropic calls. No changes to `parse-xml.ts`, `insert.ts`, or `@nihongo/gen`.

**Tech Stack:** TypeScript (ESM / NodeNext), tsx, vitest, `pg`, `@nihongo/gen` (Claude sentence generation + kuromoji furigana + pricing).

---

## File Structure

- **Modify:** `seed/src/import.ts` — extract pure helpers + DI orchestrator `run()`; move the batch loop into `importRemainingViaClaude()`; guard `main()` so importing the module has no side effects.
- **Create:** `seed/src/import.test.ts` — unit tests for the helpers + an in-process dry-run test of `run()` (uses the existing `fixtures/deck.xml`, stubbed deps, no DB).
- **Unchanged:** `seed/src/parse-xml.ts`, `seed/src/insert.ts`, `seed/src/fixtures/deck.xml`, anything under `gen/`.

Reference facts used throughout this plan (verified against the current code):

- `parseDeckXml(xml: string): CardInput[]` where `CardInput = { external_id: string; japanese: string; english: string }` (from `./parse-xml.js`).
- `insertSeedItems(pool, items): Promise<{ inserted: number; skipped: number }>` (from `./insert.js`).
- `generateSentencesForCards(cards): Promise<{ sentences: SentenceForCard[]; usage: Usage; raw: string }>`, `toRubyHtml(jp): Promise<string>`, `readingFor(jp): Promise<string>`, `computeCost(usage): number` (from `@nihongo/gen`). `Usage = { input_tokens: number; output_tokens: number }`. Pricing: `INPUT_PER_MTOK = 3.0`, `OUTPUT_PER_MTOK = 15.0`.
- The existing test fixture `seed/src/fixtures/deck.xml` parses to exactly 3 cards: `card-001` 食べる/to eat, `card-002` 水/water, `card-003` 美味しい/delicious.
- The seed workspace `test` script is `vitest run`. A single file can be filtered with a positional path arg.

---

## Task 1: Make `import.ts` importable + extract `parseArgs`

The current file calls `main()` unconditionally at top level, so importing it in a test would execute production code. We add a direct-execution guard (so the module can be imported with no side effects) and extract the first pure helper, `parseArgs`.

**Files:**
- Modify: `seed/src/import.ts`
- Test: `seed/src/import.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `seed/src/import.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseArgs } from "./import.js";

describe("parseArgs", () => {
  it("parses a bare file path", () => {
    expect(parseArgs(["deck.xml"])).toEqual({ dryRun: false, xmlPath: "deck.xml" });
  });

  it("detects --dry-run before the path", () => {
    expect(parseArgs(["--dry-run", "deck.xml"])).toEqual({ dryRun: true, xmlPath: "deck.xml" });
  });

  it("detects --dry-run after the path", () => {
    expect(parseArgs(["deck.xml", "--dry-run"])).toEqual({ dryRun: true, xmlPath: "deck.xml" });
  });

  it("returns an undefined path when only a flag is given", () => {
    expect(parseArgs(["--dry-run"])).toEqual({ dryRun: true, xmlPath: undefined });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace seed test -- src/import.test.ts`
Expected: FAIL — importing `./import.js` either errors (top-level `main()` throws `DATABASE_URL is required`) or `parseArgs` is `undefined` / not a function.

- [ ] **Step 3: Add the guard and `parseArgs` to `import.ts`**

In `seed/src/import.ts`, add the `fileURLToPath` import near the other `node:` imports:

```ts
import { fileURLToPath } from "node:url";
```

Add the `ParsedArgs` type and `parseArgs` function immediately after the `const BATCH_SIZE = 20;` line:

```ts
export type ParsedArgs = { dryRun: boolean; xmlPath: string | undefined };

export function parseArgs(argv: string[]): ParsedArgs {
  let dryRun = false;
  let xmlPath: string | undefined;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (xmlPath === undefined) xmlPath = arg;
  }
  return { dryRun, xmlPath };
}
```

Replace the final line of the file:

```ts
main().catch((e) => { console.error(e); process.exit(1); });
```

with a guarded invocation:

```ts
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace seed test -- src/import.test.ts`
Expected: PASS — 4 passing `parseArgs` tests. (The module now imports cleanly because `main()` no longer runs on import.)

- [ ] **Step 5: Commit**

```bash
git add seed/src/import.ts seed/src/import.test.ts
git commit -m "refactor(seed): guard direct execution and extract parseArgs"
```

---

## Task 2: Extract `formatSamplePreview`

Always-on sample preview of the first N parsed cards, as a pure string builder.

**Files:**
- Modify: `seed/src/import.ts`
- Test: `seed/src/import.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `seed/src/import.test.ts` (and add `formatSamplePreview` to the existing import line from `./import.js`, plus add `import type { CardInput } from "./parse-xml.js";` at the top):

```ts
describe("formatSamplePreview", () => {
  const cards: CardInput[] = [
    { external_id: "a", japanese: "猫", english: "cat" },
    { external_id: "b", japanese: "犬", english: "dog" },
  ];

  it("renders a header with counts and one row per card", () => {
    const out = formatSamplePreview(cards);
    expect(out).toContain("--- sample (first 2 of 2) ---");
    expect(out).toContain("a | 猫 | cat");
    expect(out).toContain("b | 犬 | dog");
    expect(out.trimEnd().endsWith("---")).toBe(true);
  });

  it("caps the sample at the limit but reports the true total", () => {
    const many: CardInput[] = Array.from({ length: 9 }, (_, i) => ({
      external_id: `id-${i}`,
      japanese: "あ",
      english: "x",
    }));
    const out = formatSamplePreview(many, 5);
    expect(out).toContain("--- sample (first 5 of 9) ---");
    expect(out.split("\n")).toHaveLength(7); // header + 5 rows + footer
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace seed test -- src/import.test.ts`
Expected: FAIL — `formatSamplePreview is not a function`.

- [ ] **Step 3: Add `formatSamplePreview` to `import.ts`**

Add after `parseArgs`:

```ts
export function formatSamplePreview(cards: CardInput[], limit = 5): string {
  const head = cards.slice(0, limit);
  const rows = head.map((c) => `${c.external_id} | ${c.japanese} | ${c.english}`);
  return [
    `--- sample (first ${head.length} of ${cards.length}) ---`,
    ...rows,
    "---",
  ].join("\n");
}
```

Update the `parse-xml.js` import in `import.ts` to also bring in the `CardInput` type:

```ts
import { parseDeckXml, type CardInput } from "./parse-xml.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace seed test -- src/import.test.ts`
Expected: PASS — `parseArgs` + `formatSamplePreview` suites green.

- [ ] **Step 5: Commit**

```bash
git add seed/src/import.ts seed/src/import.test.ts
git commit -m "feat(seed): add sample-preview formatter for importer"
```

---

## Task 3: Extract `estimateCost`

Coarse dry-run cost estimate. Reuses `computeCost` (already imported) so the pricing math stays DRY — we only model token counts here.

**Files:**
- Modify: `seed/src/import.ts`
- Test: `seed/src/import.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `seed/src/import.test.ts` (add `estimateCost` and `BATCH_SIZE` to the `./import.js` import line):

```ts
describe("estimateCost", () => {
  it("returns zero cost and zero batches for an empty import", () => {
    expect(estimateCost(0)).toEqual({ batches: 0, estCostUsd: 0 });
  });

  it("computes batch count from the batch size (ceil)", () => {
    expect(estimateCost(BATCH_SIZE + 1).batches).toBe(2);
  });

  it("produces a positive, sub-guardrail cost for ~300 cards", () => {
    const { estCostUsd } = estimateCost(300);
    expect(estCostUsd).toBeGreaterThan(0);
    expect(estCostUsd).toBeLessThan(5); // stays under the >$5 "stop and look" guardrail
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace seed test -- src/import.test.ts`
Expected: FAIL — `estimateCost is not a function` (and possibly `BATCH_SIZE` undefined if not yet exported).

- [ ] **Step 3: Add `estimateCost` and export `BATCH_SIZE`**

Change the existing constant declaration in `import.ts` from:

```ts
const BATCH_SIZE = 20;
```

to:

```ts
export const BATCH_SIZE = 20;

// --- Coarse cost-estimate heuristics (dry-run only) ---
// Grounded in the SentencesForCards prompt: a ~120-token system prompt, one
// short user line per card, and one small JSON object per card in the reply.
// Deliberately approximate — the estimate is a >$5 "stop and look" guardrail,
// not an invoice.
export const SYSTEM_PROMPT_TOKENS = 200;
export const INPUT_TOKENS_PER_CARD = 40;
export const OUTPUT_TOKENS_PER_CARD = 100;
```

Add the `estimateCost` function after `formatSamplePreview`:

```ts
export type CostEstimate = { batches: number; estCostUsd: number };

export function estimateCost(remaining: number, batchSize = BATCH_SIZE): CostEstimate {
  const batches = Math.ceil(remaining / batchSize);
  const usage = {
    input_tokens: batches * SYSTEM_PROMPT_TOKENS + remaining * INPUT_TOKENS_PER_CARD,
    output_tokens: remaining * OUTPUT_TOKENS_PER_CARD,
  };
  return { batches, estCostUsd: computeCost(usage) };
}
```

(`computeCost` is already imported at the top of the file. `Math.ceil(0 / 20) === 0`, so the empty case returns `{ batches: 0, estCostUsd: 0 }`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace seed test -- src/import.test.ts`
Expected: PASS — three suites green.

- [ ] **Step 5: Commit**

```bash
git add seed/src/import.ts seed/src/import.test.ts
git commit -m "feat(seed): add coarse dry-run cost estimator"
```

---

## Task 4: DI orchestrator `run()` + rewire `main()` + dry-run integration test

Move all orchestration into a testable `run(argv, deps)` that prints the preview, runs the idempotency check via an injected `findExisting`, and either prints the dry-run estimate (and returns) or delegates the real import to an injected `importRemaining`. `main()` wires the production Postgres pool and Claude path and is the only place that touches the network/DB.

**Files:**
- Modify: `seed/src/import.ts`
- Test: `seed/src/import.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `seed/src/import.test.ts`. Add `run`, `type RunSummary` to the `./import.js` import line, and add these imports at the top of the file:

```ts
import { fileURLToPath } from "node:url";
import path from "node:path";
```

Then the test block:

```ts
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/deck.xml"); // parses to 3 cards

describe("run (dry-run)", () => {
  it("prints parsed count, sample, and estimate without importing", async () => {
    const logs: string[] = [];
    let importCalls = 0;

    const code = await run(["--dry-run", FIXTURE], {
      findExisting: async () => new Set<string>(),
      importRemaining: async (): Promise<RunSummary> => {
        importCalls += 1;
        return { inserted: 0, skipped: 0, failedBatches: 0, cost: 0 };
      },
      log: (m) => logs.push(m),
    });

    const out = logs.join("\n");
    expect(code).toBe(0);
    expect(out).toContain("parsed 3 cards");
    expect(out).toContain("--- sample (first 3 of 3) ---");
    expect(out).toContain("0 already seeded; 3 to import");
    expect(out).toMatch(/dry-run: would import 3 cards in 1 batches; est\. cost ≈ \$\d+\.\d{2}/);
    expect(importCalls).toBe(0); // dry-run inserts nothing
  });

  it("subtracts already-seeded cards from the remaining count", async () => {
    const logs: string[] = [];
    const code = await run(["--dry-run", FIXTURE], {
      findExisting: async () => new Set(["card-001"]),
      importRemaining: async (): Promise<RunSummary> =>
        ({ inserted: 0, skipped: 0, failedBatches: 0, cost: 0 }),
      log: (m) => logs.push(m),
    });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("1 already seeded; 2 to import");
  });

  it("returns exit code 2 on missing path", async () => {
    const logs: string[] = [];
    const code = await run(["--dry-run"], {
      findExisting: async () => new Set<string>(),
      importRemaining: async (): Promise<RunSummary> =>
        ({ inserted: 0, skipped: 0, failedBatches: 0, cost: 0 }),
      log: (m) => logs.push(m),
    });
    expect(code).toBe(2);
    expect(logs.join("\n")).toContain("usage:");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace seed test -- src/import.test.ts`
Expected: FAIL — `run is not a function`.

- [ ] **Step 3: Rewrite the orchestration in `import.ts`**

Add `import type { Pool } from "pg";` alongside the existing `import pg from "pg";`.

Add the orchestrator and its types after `estimateCost`:

```ts
export type RunSummary = {
  inserted: number;
  skipped: number;
  failedBatches: number;
  cost: number;
};

export type RunDeps = {
  findExisting: (cards: CardInput[]) => Promise<Set<string>>;
  importRemaining: (cards: CardInput[]) => Promise<RunSummary>;
  log: (msg: string) => void;
};

export async function run(argv: string[], deps: RunDeps): Promise<number> {
  const { dryRun, xmlPath } = parseArgs(argv);
  if (!xmlPath) {
    deps.log("usage: tsx src/import.ts [--dry-run] <path-to-deck.xml>");
    return 2;
  }

  const xml = readFileSync(xmlPath, "utf8");
  const allCards = parseDeckXml(xml);
  deps.log(`parsed ${allCards.length} cards from ${xmlPath}`);
  deps.log(formatSamplePreview(allCards));

  const existing = await deps.findExisting(allCards);
  const cards = allCards.filter((c) => !existing.has(c.external_id));
  deps.log(`${existing.size} already seeded; ${cards.length} to import`);

  if (dryRun) {
    const { batches, estCostUsd } = estimateCost(cards.length);
    deps.log(
      `dry-run: would import ${cards.length} cards in ${batches} batches; est. cost ≈ $${estCostUsd.toFixed(2)}`,
    );
    return 0;
  }

  const summary = await deps.importRemaining(cards);
  deps.log("---");
  deps.log(
    `done. inserted=${summary.inserted} skipped=${summary.skipped} failed_batches=${summary.failedBatches} cost=$${summary.cost.toFixed(4)}`,
  );
  return 0;
}
```

Add the production helpers (the batch loop, moved verbatim from the old `main()`, now returning a `RunSummary`):

```ts
async function findExistingInDb(pool: Pool, cards: CardInput[]): Promise<Set<string>> {
  const res = await pool.query<{ external_id: string }>(
    `SELECT external_id FROM items WHERE source='seed' AND external_id = ANY($1::text[])`,
    [cards.map((c) => c.external_id)],
  );
  return new Set(res.rows.map((r) => r.external_id));
}

async function importRemainingViaClaude(pool: Pool, cards: CardInput[]): Promise<RunSummary> {
  let inserted = 0;
  let skipped = 0;
  let failedBatches = 0;
  let cost = 0;

  for (let i = 0; i < cards.length; i += BATCH_SIZE) {
    const batch = cards.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(cards.length / BATCH_SIZE);
    console.log(`batch ${batchNum}/${totalBatches} (${batch.length} cards)…`);
    try {
      const result = await generateSentencesForCards(batch);
      cost += computeCost(result.usage);

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
          answer: { meaning: card.english, reading },
        });
      }
      const ins = await insertSeedItems(pool, items);
      inserted += ins.inserted;
      skipped += ins.skipped;
      console.log(`  inserted=${ins.inserted} skipped=${ins.skipped} cost_so_far=$${cost.toFixed(4)}`);
    } catch (err) {
      failedBatches += 1;
      console.error(`  batch failed:`, err instanceof Error ? err.message : err);
    }
  }
  return { inserted, skipped, failedBatches, cost };
}
```

Replace the entire old `main()` function with the thin wiring version:

```ts
async function main() {
  const { dryRun, xmlPath } = parseArgs(process.argv.slice(2));
  if (!xmlPath) {
    console.error("usage: tsx src/import.ts [--dry-run] <path-to-deck.xml>");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const code = await run(process.argv.slice(2), {
      findExisting: (cards) => findExistingInDb(pool, cards),
      importRemaining: (cards) => importRemainingViaClaude(pool, cards),
      log: (msg) => console.log(msg),
    });
    process.exitCode = code;
  } finally {
    await pool.end();
  }
}
```

Notes for the implementer:
- `ANTHROPIC_API_KEY` is now only required for a real run; dry-run no longer needs it (it never calls Claude). `DATABASE_URL` is still required for both, because the dry-run idempotency check (`findExisting`) hits the DB — this is intentional so the operational dry-run against prod reports the true "already seeded" count.
- The final `done.` line's `skipped` now counts only `ON CONFLICT` skips within the remaining set; already-seeded cards are reported on the separate `N already seeded` line. This is a deliberate, clearer split from the old behavior (which folded already-seeded into `skipped`).
- The usage string is intentionally repeated in both `run()` and `main()`: `main()` checks the path before env vars so a bad invocation still exits 2 without requiring `DATABASE_URL`, while `run()`'s check is what the unit test exercises.

- [ ] **Step 4: Run the full seed suite to verify everything passes**

Run: `npm --workspace seed test`
Expected: PASS — `parse-xml.test.ts` (4 tests) + `import.test.ts` (all suites incl. the 3 dry-run tests) green.

- [ ] **Step 5: Verify the real CLI still type-checks and shows usage**

Run: `npm --workspace seed run import`
Expected: prints `usage: tsx src/import.ts [--dry-run] <path-to-deck.xml>` and exits with code 2. (No DB/env needed — the path check comes first.)

- [ ] **Step 6: Commit**

```bash
git add seed/src/import.ts seed/src/import.test.ts
git commit -m "feat(seed): add --dry-run via injectable run() orchestrator"
```

---

## Task 5: Operational import against production (manual — not committed code)

This task performs the real import. It produces no commits; it changes the prod database. Execute the steps in order and stop if any check is surprising. The source file is personal study material and must never be committed.

Source file (verified location): `/Users/michaelgalloway/Library/Mobile Documents/com~apple~CloudDocs/Personal study.xml`

> Prod connection details (server `spruce-cedar.exe.xyz`, SSH user, DB credentials, passcode) are in the project memory under "Production config". Read those before starting rather than guessing.

- [ ] **Step 1: Establish a connection to the prod database**

Prefer an SSH tunnel over exposing prod Postgres. In one terminal:

```bash
ssh -L 5432:localhost:5432 <prod-ssh-user>@spruce-cedar.exe.xyz
```

Fetch the prod DB credentials from the server's `.env` (do not commit them); construct a local URL of the form:

```
postgres://<user>:<password>@localhost:5432/<dbname>
```

Sanity-check connectivity (should print the existing source/skill breakdown — expect only `ai` rows, no `seed` rows yet):

```bash
psql "postgres://<user>:<password>@localhost:5432/<dbname>" \
  -c "SELECT source, skill, count(*) FROM items GROUP BY 1,2 ORDER BY 1,2;"
```

- [ ] **Step 2: Dry-run against prod**

```bash
DATABASE_URL="postgres://<user>:<password>@localhost:5432/<dbname>" \
  npm --workspace seed run import -- --dry-run \
  "/Users/michaelgalloway/Library/Mobile Documents/com~apple~CloudDocs/Personal study.xml"
```

Expected output:
- `parsed ~300 cards from …`
- a `--- sample (first 5 of ~300) ---` block with 5 `external_id | japanese | english` rows
- `0 already seeded; ~300 to import`
- `dry-run: would import ~300 cards in ~15 batches; est. cost ≈ $0.XX`

**Decision gate:** if the parsed count is wildly off (e.g. 0 or thousands), or the estimate exceeds **$5**, STOP and inspect before proceeding.

- [ ] **Step 3: Real run against prod**

```bash
DATABASE_URL="postgres://<user>:<password>@localhost:5432/<dbname>" \
ANTHROPIC_API_KEY="<key>" \
  npm --workspace seed run import -- \
  "/Users/michaelgalloway/Library/Mobile Documents/com~apple~CloudDocs/Personal study.xml"
```

Expected: per-batch progress (`batch k/~15 …`, `inserted=… skipped=… cost_so_far=$…`), then a final `done. inserted=… skipped=… failed_batches=… cost=$…` line. If `failed_batches > 0`, re-run the exact same command — idempotency (`ON CONFLICT (source, external_id) DO NOTHING`) makes re-runs safe and they pick up only the unimported cards.

- [ ] **Step 4: Verify in the database**

```bash
psql "postgres://<user>:<password>@localhost:5432/<dbname>" \
  -c "SELECT source, skill, count(*) FROM items GROUP BY 1,2 ORDER BY 1,2;"
```

Expected: a new `seed | vocab | ~300` row (close to the parsed count, allowing for any failed batches awaiting a re-run).

- [ ] **Step 5: Verify in the deployed app**

- Open https://spruce-cedar.exe.xyz, log in with the passcode.
- The dashboard's Vocab card should show the imported items in its "new" bucket count.
- Practice → first vocab card should render with a generated example sentence, kuromoji ruby, the target word, and the meaning + reading.

- [ ] **Step 6: Close the SSH tunnel**

Terminate the `ssh -L …` session from Step 1.

---

## Self-Review

**Spec coverage:**
- `--dry-run` flag → Tasks 1 (parseArgs) + 4 (run honors it). ✓
- Always-on sample preview (first 5) → Task 2 + wired in Task 4's `run()`. ✓
- Cost estimate (dry-run only, reuses pricing) → Task 3 + emitted in Task 4. ✓
- CLI integration test for dry-run incl. "no rows inserted" → Task 4 (`importCalls === 0` ≡ no insert path executed; runs with no DB). ✓
- Exit codes: dry-run 0, real 0/1, bad usage 2 → Task 4 (`run` returns 0/2; `main` sets `process.exitCode`, guarded `main()` sets 1 on throw). ✓
- No changes to `parse-xml.ts` / `insert.ts` / `@nihongo/gen` → respected; only `import.ts` touched. ✓
- Operational dry-run → real → verify against prod, source file not committed → Task 5. ✓
- Success criteria (`--dry-run` + preview present, test passes, seed rows ≈ card count, app plays an item end-to-end) → Tasks 1–5. ✓

**Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N". Every code step shows complete code; every command shows expected output. ✓

**Type consistency:** `CardInput` (parse-xml), `RunSummary`/`RunDeps`/`CostEstimate`/`ParsedArgs` (import.ts) used identically across tasks. `findExisting`/`importRemaining`/`log` dep names match between the test stubs (Task 4 Step 1) and the `RunDeps` type + `main()` wiring (Task 4 Step 3). `estimateCost` returns `{ batches, estCostUsd }` everywhere it's referenced. `BATCH_SIZE` exported in Task 3, consumed in Task 4. ✓
