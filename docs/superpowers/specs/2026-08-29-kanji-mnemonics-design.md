# Kanji mnemonics — design

**Date:** 2026-08-29
**Branch:** `feat/kanji-mnemonics`
**Issue:** [#23 Add mnemonics to kanji](https://github.com/ascii27/nihongo-practice/issues/23)

## Problem

A kanji card today shows the glyph, then flips to meanings, readings and a
stroke count (`KanjiCard.tsx:63-72`). That is a lookup, not a memory aid.
Nothing links the shape of 整 to "organize", and nothing makes セイ stick. The
learner is left to brute-force ~2,136 jōyō characters and their readings.

## Goal

Give every kanji a WaniKani-flavoured mnemonic: a short absurd scene for the
meaning, an English sound hook per important reading, and one real example
sentence per reading. Vivid, funny, replayable in the head — the learner sees
整 later and the scene fires before the dictionary does.

## Decisions

| Question | Decision |
|---|---|
| "Drawing" in the request | The existing stroke-order Draw mode. No image generation, no illustration assets. |
| Example sentence per reading | Full Japanese sentence + English translation, not just a vocab word |
| When are mnemonics generated | Lazily, the first time the Mnemonic tab is opened for that kanji; cached forever |
| Where it shows | A third tab beside Recognize / Draw |
| Bad mnemonic escape hatch | A "Try another" regenerate action on the tab |
| Which readings get mnemonics | The model picks: the main on'yomi plus 1–3 important kun'yomi, capped at 4 total |

Lazy beats a bulk backfill here. A full jōyō run is ~$25 of mnemonics nobody
asked for, most for kanji that will not come up for months. On-demand costs
about a cent per character and only for characters the learner actually wanted
help with. The trade is a few seconds of latency the first time a tab is
opened, which a loading state covers.

Generation is bound to *opening the tab*, not to dealing the card. Binding it
to the card would spend money on every kanji that scrolls past.

## Data model

One migration, `db/migrations/1783987200000_kanji_mnemonics.sql`:

```sql
CREATE TABLE kanji_mnemonics (
  character     text PRIMARY KEY REFERENCES kanji(character) ON DELETE CASCADE,
  content       jsonb NOT NULL,
  model         text NOT NULL,
  cost_usd      numeric(10,6) NOT NULL DEFAULT 0,
  generated_at  timestamptz NOT NULL DEFAULT now()
);
```

A separate table rather than columns on `kanji`. `import-kanji` re-upserts the
whole `kanji` row on every run (`import-kanji.ts:65-73`), and generated content
has a different lifecycle from seeded reference data — it has a model, a cost,
and can be thrown away and remade. The foreign key means a character can only
have a mnemonic if it exists in the reference table.

`model` and `cost_usd` sit on the row rather than in `generations`. The
`generations` table is an audit of item top-ups — rows there carry
`count_requested` / `count_inserted` and feed the AI-spend view. A mnemonic
creates no items, so it would land there as a permanent zero-item row. Cost
stays queryable: `SELECT sum(cost_usd) FROM kanji_mnemonics`.

## Shared types

`shared/src/types.ts`, next to the other kanji schemas:

```ts
export const KanjiMnemonicSentence = z.object({
  jp: z.string(),
  jp_ruby: z.string(),   // furigana HTML, as produced by toRubyHtml
  en: z.string(),
});

export const KanjiMnemonicReading = z.object({
  type: z.enum(["on", "kun"]),
  reading: z.string(),        // セイ / ととのえる
  sound_hook: z.string(),     // SAY / TOTAL NO
  scene: z.string(),          // the mini-story tying hook to meaning
  sentence: KanjiMnemonicSentence,
  note: z.string().optional(), // 整える = you arrange something
});

export const KanjiMnemonic = z.object({
  character: z.string(),
  meaning: z.object({
    gloss: z.string(),   // "organize / arrange"
    scene: z.string(),   // the visual breakdown scene
    hook: z.string(),    // "messy bundle → make it correct → ORGANIZE"
  }),
  readings: z.array(KanjiMnemonicReading).min(1).max(4),
  recap: z.array(z.string()).max(5),  // "セイ → SAY it looks good"
});
```

`note` is how the issue's "related readings" section is carried: it is only
emitted when a kanji has several related kunyomi whose difference is worth
spelling out (降りる get off / 降ろす lower something / 降る rain falls). Most
readings will not have one.

`jp_ruby` is filled server-side, not by the model. The rest of the app renders
Japanese with furigana via `toRubyHtml` (`lesson-generate.ts:54-58`); mnemonic
sentences do the same so they do not look foreign on the card.

## Generation (`gen`)

Three additions, following the existing prompt → parse → generate split.

### `prompt.ts` — `buildKanjiMnemonicPrompt`

The system prompt encodes issue #23's rules directly:

- Meaning first, from the kanji's most useful everyday sense.
- Break the glyph into recognizable components and stage a short concrete scene
  connecting shape to meaning. State plainly that the breakdown is a memory aid
  and **must not** be presented as historical etymology.
- One English sound hook per reading (ユウ → YOU, セイ → SAY, ととのえる →
  TOTAL NO). Approximate is fine; memorable beats phonetically correct.
- One natural example sentence per reading that contains the kanji *and* uses
  that specific reading, short and modern.
- Prefer absurd imagery, strong actions, emotion, familiar English words.
- Avoid long explanations, obscure vocabulary, academic radical analysis, and
  rare readings.

The user message supplies the character, its KANJIDIC2 meanings, and the full
on/kun lists, and asks the model to choose the main on'yomi plus the kun'yomi a
learner will actually meet — at most 4 readings total. Picking the readings is
the model's job, per the issue's "prioritize the readings a learner is actually
likely to encounter".

Output is a single JSON object (like `parseManualVocab`, not a batch) matching
the shape above minus `jp_ruby`.

### `parse.ts` — `parseKanjiMnemonic`

`stripFences` then structural validation in the style of the existing hand-
rolled parsers: meaning fields present and non-empty, `readings` a non-empty
array, each reading with a valid `type` and non-empty `reading` / `sound_hook`
/ `scene` / sentence pair. Over-long `readings` arrays are truncated to 4
rather than rejected — a model that offers five good readings should not fail
the whole call. Anything genuinely malformed throws, and the existing retry in
`callAndParse` handles it.

### `generate.ts` — `generateKanjiMnemonic`

Thin wrapper over the shared `callAndParse`, returning `{ mnemonic, usage }`
like its siblings. Exported from `gen/src/index.ts`.

## Server

### `services/kanji-mnemonic.ts` (new)

```ts
getKanjiMnemonic(character): Promise<KanjiMnemonic>      // cache, else generate
regenerateKanjiMnemonic(character): Promise<KanjiMnemonic>  // delete, then generate
```

`getKanjiMnemonic`:

1. `SELECT content FROM kanji_mnemonics WHERE character = $1` — hit, return.
2. Read the character's meanings and readings from `kanji`. Missing → throw a
   not-found the route turns into 404.
3. `generateKanjiMnemonic`, then `toRubyHtml` each sentence's Japanese.
4. `INSERT … ON CONFLICT (character) DO NOTHING`, then re-read the row and
   return that.

Step 4 is what makes a double-tap safe: two concurrent opens can both generate,
but only one row survives and both callers return the same mnemonic. Losing a
race costs a cent of wasted tokens, which is cheaper than the lock machinery
that would prevent it.

`regenerateKanjiMnemonic` deletes the row and calls the same path, so a
regenerate that fails mid-flight leaves no mnemonic rather than a broken one —
the next open regenerates.

### `routes/kanji.ts`

```
GET  /api/kanji/:character/mnemonic            → KanjiMnemonic | 404
POST /api/kanji/:character/mnemonic/regenerate → KanjiMnemonic | 404
```

Both sit behind the existing passcode auth on `/api`. The `:character/mnemonic`
route must be registered before the existing `/:character` handler is reached —
Express matches in order, and `/:character` would otherwise swallow nothing
here, but keeping the more specific route first is the safer habit.

Generation failure returns 502 with a `MNEMONIC_FAILED` code so the client can
say "couldn't write one — try again" rather than showing an empty tab.

## Client

### `KanjiMnemonicCard.tsx` (new)

Owns its own fetch, loading and error state, mirroring how `KanjiDrawCard`
fetches stroke data on mount (`KanjiDrawCard.tsx:36`). Fetches on mount — and
the component only mounts when the tab is selected, which is what keeps
generation on-demand.

Layout, top to bottom:

- **Meaning** — the gloss, the scene, then the `hook` line set apart as the
  thing to replay.
- **Per reading** — the reading and its sound hook as a header pair
  (セイ → SAY), the mini-story, then the example sentence: Japanese with ruby,
  English beneath. `note` renders as a short aside when present.
- **Recap** — the compact list, visually quiet.
- **Try another** — a low-emphasis regenerate action; disabled with a spinner
  while in flight.

Loading is a skeleton with an honest line ("writing a mnemonic…"), because a
first generation takes several seconds.

### `KanjiCard.tsx`

`Mode` becomes `"recognize" | "draw" | "mnemonic"` and the existing
`role="tablist"` gains a third button. `canSwipe` stays
`mode === "recognize" && flipped`, so the mnemonic tab does not grade by
swipe — same as Draw today.

Opening the tab before flipping does spoil the answer. That is already true of
Draw mode, which is handed the meaning and reading up front
(`KanjiCard.tsx:88-91`), so this follows the established behaviour rather than
inventing a guard for it.

### `api-hooks.ts`

`fetchKanjiMnemonic(character)` and `regenerateKanjiMnemonic(character)`,
alongside the existing kanji helpers.

### Styles

Mnemonic blocks in `client/src/styles/` following the Ink & Stone conventions
already used by the flip card. The scene text is the loudest element after the
glyph; the recap is the quietest.

## Testing

**`gen`** — a prompt-builder test asserting the character, meanings and reading
lists reach the user message; parse tests for a valid object, a fenced object,
missing meaning fields, an empty `readings` array, a reading missing its
sentence, and a five-reading response truncating to four.

**`server`** — service tests against a stubbed generate client: cache hit does
not call the model; cache miss generates, ruby-annotates and stores; a second
concurrent call returns the stored row rather than a duplicate; regenerate
replaces the row; unknown character throws. Route tests for 200 on both
endpoints, 404 on an unknown character, and 502 when generation throws.

**`e2e`** — `kanji.spec.ts` gains a seeded `kanji_mnemonics` fixture row so the
Mnemonic tab renders from cache. CI has no API key, so the e2e path must never
depend on a live generation.

## Out of scope

- Bulk backfill of all ~2,136 jōyō kanji. The lazy path fills the table as the
  learner studies. If a backfill is ever wanted, it is a small script over the
  same service.
- Hand-editing mnemonics in the UI. Regenerate is the escape hatch; a bad one
  can also be deleted in SQL.
- Mnemonics anywhere but the kanji review card — no browse-screen surface.
