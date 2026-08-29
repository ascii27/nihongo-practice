# Kanji Mnemonics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every kanji card a WaniKani-style mnemonic — an absurd scene for the meaning, an English sound hook per important reading, and one example sentence per reading — generated on demand and cached forever.

**Architecture:** A new `kanji_mnemonics` table caches one generated mnemonic per character. `gen` gains a prompt/parse/generate trio matching the existing single-object generators (`generateManualVocab` is the model to copy). A server service does get-or-generate, ruby-annotating the example sentences before storing. The client gets a third tab on `KanjiCard`; mounting that tab is what triggers generation, so nothing is spent on kanji the learner never asks about.

**Tech Stack:** TypeScript, Express, Postgres (node-pg + plain SQL migrations), React, Zod (shared schemas), Vitest (unit), Playwright (e2e), Anthropic SDK via the `gen` workspace.

**Spec:** `docs/superpowers/specs/2026-08-29-kanji-mnemonics-design.md`

## Global Constraints

- Branch: `feat/kanji-mnemonics`. Do not merge to `main`.
- Model constant and cost helper come from `@nihongo/gen` (`MODEL`, `computeCost`). Never hardcode a model id or price.
- Every generator in `gen/src/generate.ts` honours `process.env.NIHONGO_FAKE_AI === "1"` by returning a deterministic fixture with zero usage. The new one must too — CI e2e runs with `NIHONGO_FAKE_AI: "1"` and no API key.
- Readings per mnemonic: at least 1, at most 4 (one main on'yomi plus 1–3 important kun'yomi).
- `character` is always the character the server asked about, never a value read from the model response.
- Japanese example sentences are ruby-annotated server-side with `toRubyHtml` from `@nihongo/gen`. Never in the client.
- Radical/component breakdowns are memory aids and must never be presented as historical etymology.
- Existing behaviour that must keep working: `canSwipe` on `KanjiCard` stays `mode === "recognize" && flipped`.
- Run commands from the repo root. Workspace tests: `npm --workspace <gen|server|client> test`.

---

### Task 1: Migration — `kanji_mnemonics` table

**Files:**
- Create: `db/migrations/1783987200000_kanji_mnemonics.sql`

**Interfaces:**
- Consumes: the existing `kanji` reference table (`character` primary key).
- Produces: table `kanji_mnemonics(character, content, model, cost_usd, generated_at)`, used by every later server task.

- [ ] **Step 1: Write the migration**

Create `db/migrations/1783987200000_kanji_mnemonics.sql`:

```sql
-- 1783987200000_kanji_mnemonics.sql
-- One generated mnemonic per kanji: an absurd scene for the meaning plus an
-- English sound hook and example sentence per important reading. Kept apart
-- from the `kanji` reference table because `import-kanji` re-upserts those rows
-- wholesale, and because generated content carries a model, a cost, and can be
-- thrown away and remade. Filled lazily, the first time a learner opens the
-- Mnemonic tab for a character.

CREATE TABLE kanji_mnemonics (
  character     text PRIMARY KEY REFERENCES kanji(character) ON DELETE CASCADE,
  content       jsonb NOT NULL,
  model         text NOT NULL,
  cost_usd      numeric(10,6) NOT NULL DEFAULT 0,
  generated_at  timestamptz NOT NULL DEFAULT now()
);
```

No index beyond the primary key: every read is a point lookup by character.

No change is needed to `server/src/db/reset.ts` or `e2e/tests/fixtures/seed-test-kanji.sql`. Both already `TRUNCATE … kanji … CASCADE`, and Postgres extends a CASCADE truncate to tables with a foreign key onto the truncated one.

- [ ] **Step 2: Apply the migration**

Run: `npm run db:migrate`

Expected: the runner reports the new migration applied.

- [ ] **Step 3: Verify the table exists with the expected shape**

Run: `psql "$DATABASE_URL" -c '\d kanji_mnemonics'`

Expected: five columns; `character` is the primary key and a foreign key to `kanji`.

- [ ] **Step 4: Verify the cascade actually reaches the new table**

Run:

```bash
psql "$DATABASE_URL" <<'SQL'
INSERT INTO kanji (character, strokes, stroke_count, meanings, on_yomi, kun_yomi)
  VALUES ('猫', '["a"]', 1, ARRAY['cat'], ARRAY['ビョウ'], ARRAY['ねこ']);
INSERT INTO kanji_mnemonics (character, content, model) VALUES ('猫', '{}', 'test');
TRUNCATE TABLE kanji RESTART IDENTITY CASCADE;
SELECT count(*) AS leftover FROM kanji_mnemonics;
SQL
```

Expected: `leftover` is `0`. If it is not, add `kanji_mnemonics` explicitly to the truncate list in `server/src/db/reset.ts` and to `e2e/tests/fixtures/seed-test-kanji.sql`.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/1783987200000_kanji_mnemonics.sql
git commit -m "feat(kanji-mnemonics): add kanji_mnemonics table"
```

---

### Task 2: Shared Zod schemas

**Files:**
- Modify: `shared/src/types.ts` (append after the `KanjiDetail` block, around line 305)

**Interfaces:**
- Consumes: nothing.
- Produces: `KanjiMnemonicSentence`, `KanjiMnemonicReading`, `KanjiMnemonic` (zod schemas + inferred types), exported from `@nihongo/shared`. The server validates with these; the client types its state with them.

- [ ] **Step 1: Add the schemas**

In `shared/src/types.ts`, directly after `export type KanjiDetail = z.infer<typeof KanjiDetail>;` and before the `// ----- Listening item -----` comment, add:

```ts
// ----- Kanji mnemonics -----
//
// A WaniKani-flavoured memory aid per kanji, generated on demand and cached in
// `kanji_mnemonics`. The meaning gets one absurd scene; each important reading
// gets an English sound hook (セイ → SAY), a mini-story tying that sound to the
// meaning, and a real example sentence that uses the kanji with that reading.

export const KanjiMnemonicSentence = z.object({
  jp: z.string(),
  jp_ruby: z.string(),   // furigana HTML, produced server-side by toRubyHtml
  en: z.string(),
});
export type KanjiMnemonicSentence = z.infer<typeof KanjiMnemonicSentence>;

export const KanjiMnemonicReading = z.object({
  type: z.enum(["on", "kun"]),
  reading: z.string(),         // セイ / ととのえる
  sound_hook: z.string(),      // SAY / TOTAL NO
  scene: z.string(),           // the mini-story tying the hook to the meaning
  sentence: KanjiMnemonicSentence,
  // Only when a kanji has several related kunyomi worth telling apart, e.g.
  // "整える = you arrange something / 整う = something becomes arranged".
  note: z.string().optional(),
});
export type KanjiMnemonicReading = z.infer<typeof KanjiMnemonicReading>;

export const KanjiMnemonic = z.object({
  character: z.string(),
  meaning: z.object({
    gloss: z.string(),   // "organize / arrange"
    scene: z.string(),   // the visual breakdown scene
    hook: z.string(),    // "messy bundle → make it correct → ORGANIZE"
  }),
  readings: z.array(KanjiMnemonicReading).min(1).max(4),
  recap: z.array(z.string()).max(5),   // "セイ → SAY it looks good"
});
export type KanjiMnemonic = z.infer<typeof KanjiMnemonic>;
```

- [ ] **Step 2: Verify the workspace still type-checks and builds**

Run: `npm --workspace shared run build`

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat(kanji-mnemonics): add KanjiMnemonic shared schemas"
```

---

### Task 3: `gen` — prompt builder

**Files:**
- Modify: `gen/src/prompt.ts` (append a new system prompt + builder)
- Modify: `gen/src/index.ts` (re-export)
- Test: `gen/src/prompt.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildKanjiMnemonicPrompt(args: { character: string; meanings: string[]; on: string[]; kun: string[] }): PromptPair` where `PromptPair = { system: string; user: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `gen/src/prompt.test.ts`, and add `buildKanjiMnemonicPrompt` to the import from `./prompt.js` at the top of the file:

```ts
describe("buildKanjiMnemonicPrompt", () => {
  const args = {
    character: "整",
    meanings: ["organize", "arrange"],
    on: ["セイ"],
    kun: ["ととの.える", "ととの.う"],
  };

  it("asks for strict JSON with the mnemonic shape", () => {
    const { system } = buildKanjiMnemonicPrompt(args);
    expect(system).toMatch(/JSON/i);
    expect(system).toContain('"meaning"');
    expect(system).toContain('"readings"');
    expect(system).toContain('"sound_hook"');
    expect(system).toContain('"sentence_japanese"');
  });

  it("forbids presenting the component breakdown as etymology", () => {
    const { system } = buildKanjiMnemonicPrompt(args);
    expect(system.toLowerCase()).toContain("etymolog");
  });

  it("caps the reading count at four", () => {
    const { system } = buildKanjiMnemonicPrompt(args);
    expect(system).toContain("4");
  });

  it("puts the character and its meanings and readings in the user message", () => {
    const { user } = buildKanjiMnemonicPrompt(args);
    expect(user).toContain("整");
    expect(user).toContain("organize, arrange");
    expect(user).toContain("セイ");
    expect(user).toContain("ととの.える");
    expect(user).toContain("ととの.う");
  });

  it("says none when a reading list is empty", () => {
    const { user } = buildKanjiMnemonicPrompt({ ...args, kun: [] });
    expect(user).toMatch(/kun'yomi[^\n]*none/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --workspace gen test -- prompt.test.ts`

Expected: FAIL — `buildKanjiMnemonicPrompt is not a function` / no export named it.

- [ ] **Step 3: Write the prompt builder**

Append to `gen/src/prompt.ts`:

```ts
const KANJI_MNEMONIC_SYSTEM = `You write vivid memory aids for a Japanese learner studying kanji, in the spirit of WaniKani: funny, visual, slightly absurd, and easy to replay in the head.

For the MEANING:
- Lead with the kanji's most useful everyday meaning.
- Break the kanji into recognizable visual components and stage one short concrete scene that connects those shapes to the meaning. Prefer concrete images and actions over abstract explanation.
- The component breakdown is a memory aid ONLY. Never present it as the historical etymology of the kanji.
- Give a compressed "hook" line the learner can replay, e.g. "messy bundle -> make it correct -> ORGANIZE".

For each READING:
- Pick the main on'yomi plus the 1 to 3 kun'yomi a learner is actually likely to meet. NEVER list rare readings. At most 4 readings in total.
- Give an English sound hook that resembles the Japanese sound (ユウ -> YOU, セイ -> SAY, ととのえる -> TOTAL NO, おりる -> OH, REAR). It does not need to be phonetically perfect; memorable beats accurate.
- Write a short scene, with emotion and a strong action, connecting that sound hook to the meaning.
- Write ONE natural everyday Japanese sentence (under 20 syllables) that contains the kanji AND uses that specific reading, plus its English translation.
- When a kanji has several related kun'yomi, add a "note" making the difference easy to remember in plain English before grammar terminology, e.g. "整える = you arrange something / 整う = something becomes arranged". Omit "note" otherwise.

Finish with a very short recap: one line per reading, like "セイ -> SAY it looks good".

Favor absurd imagery, strong actions, emotion, familiar English words, and one clear mental image. Avoid long explanations, obscure vocabulary, academic radical analysis, and weak sound associations where a fun approximation is possible.

Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "meaning": { "gloss": "<short English gloss>", "scene": "<the visual scene>", "hook": "<compressed replay line>" },
  "readings": [ { "type": "on" | "kun", "reading": "<JA reading>", "sound_hook": "<ENGLISH SOUND>", "scene": "<mini story>", "sentence_japanese": "<JA>", "sentence_english": "<EN>", "note": "<optional>" } ],
  "recap": [ "<one line per reading>" ] }`;

export function buildKanjiMnemonicPrompt(args: {
  character: string;
  meanings: string[];
  on: string[];
  kun: string[];
}): PromptPair {
  const list = (xs: string[]) => (xs.length ? xs.join("、") : "none");
  const user = [
    `Write a mnemonic for the kanji ${args.character}.`,
    `Dictionary meanings: ${args.meanings.length ? args.meanings.join(", ") : "unknown"}`,
    `Known on'yomi: ${list(args.on)}`,
    `Known kun'yomi: ${list(args.kun)}`,
    `Choose the main on'yomi and only the kun'yomi a learner will actually encounter. At most 4 readings total.`,
  ].join("\n");
  return { system: KANJI_MNEMONIC_SYSTEM, user };
}
```

- [ ] **Step 4: Export it**

In `gen/src/index.ts`, add `buildKanjiMnemonicPrompt` to the existing `export { … } from "./prompt.js";` list.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --workspace gen test -- prompt.test.ts`

Expected: PASS, including the pre-existing prompt tests.

- [ ] **Step 6: Commit**

```bash
git add gen/src/prompt.ts gen/src/prompt.test.ts gen/src/index.ts
git commit -m "feat(kanji-mnemonics): add mnemonic prompt builder"
```

---

### Task 4: `gen` — response parser

**Files:**
- Modify: `gen/src/parse.ts`
- Modify: `gen/src/index.ts` (re-export)
- Test: `gen/src/parse.test.ts`

**Interfaces:**
- Consumes: `stripFences` from the same file.
- Produces:

```ts
export type KanjiMnemonicReadingRaw = {
  type: "on" | "kun";
  reading: string;
  sound_hook: string;
  scene: string;
  sentence_japanese: string;
  sentence_english: string;
  note?: string;
};
export type KanjiMnemonicRaw = {
  meaning: { gloss: string; scene: string; hook: string };
  readings: KanjiMnemonicReadingRaw[];   // 1..4
  recap: string[];
};
export function parseKanjiMnemonic(raw: string): KanjiMnemonicRaw;
```

Note the `Raw` suffix and flat `sentence_japanese` / `sentence_english` fields: this is the model's wire shape, before the server adds ruby and reshapes it into the nested `KanjiMnemonic` from `@nihongo/shared`. Keep them distinct.

- [ ] **Step 1: Write the failing tests**

Append to `gen/src/parse.test.ts`, adding `parseKanjiMnemonic` to the existing import from `./parse.js`:

```ts
describe("parseKanjiMnemonic", () => {
  const reading = {
    type: "on",
    reading: "セイ",
    sound_hook: "SAY",
    scene: "You finish tidying and shout: SAY it looks good!",
    sentence_japanese: "部屋を整理しました。",
    sentence_english: "I organized the room.",
  };
  const valid = {
    meaning: { gloss: "organize", scene: "A messy bundle beaten into shape.", hook: "messy bundle -> ORGANIZE" },
    readings: [reading],
    recap: ["セイ -> SAY it looks good"],
  };

  it("returns the meaning, readings and recap", () => {
    const out = parseKanjiMnemonic(JSON.stringify(valid));
    expect(out.meaning.gloss).toBe("organize");
    expect(out.readings).toHaveLength(1);
    expect(out.readings[0].sound_hook).toBe("SAY");
    expect(out.readings[0].sentence_japanese).toBe("部屋を整理しました。");
    expect(out.recap).toEqual(["セイ -> SAY it looks good"]);
  });

  it("strips code fences", () => {
    const out = parseKanjiMnemonic("```json\n" + JSON.stringify(valid) + "\n```");
    expect(out.meaning.gloss).toBe("organize");
  });

  it("keeps an optional note when present", () => {
    const withNote = { ...valid, readings: [{ ...reading, note: "整える = you arrange something" }] };
    expect(parseKanjiMnemonic(JSON.stringify(withNote)).readings[0].note)
      .toBe("整える = you arrange something");
  });

  it("defaults a missing recap to an empty list", () => {
    const { recap, ...noRecap } = valid;
    expect(parseKanjiMnemonic(JSON.stringify(noRecap)).recap).toEqual([]);
  });

  it("truncates to four readings", () => {
    const five = { ...valid, readings: [1, 2, 3, 4, 5].map((n) => ({ ...reading, reading: `セイ${n}` })) };
    const out = parseKanjiMnemonic(JSON.stringify(five));
    expect(out.readings).toHaveLength(4);
    expect(out.readings[3].reading).toBe("セイ4");
  });

  it("throws when meaning fields are missing", () => {
    const bad = { ...valid, meaning: { gloss: "organize" } };
    expect(() => parseKanjiMnemonic(JSON.stringify(bad))).toThrow(/meaning/i);
  });

  it("throws when readings is empty", () => {
    expect(() => parseKanjiMnemonic(JSON.stringify({ ...valid, readings: [] }))).toThrow(/reading/i);
  });

  it("throws when a reading has no sentence", () => {
    const { sentence_japanese, ...noSentence } = reading;
    const bad = { ...valid, readings: [noSentence] };
    expect(() => parseKanjiMnemonic(JSON.stringify(bad))).toThrow(/reading/i);
  });

  it("throws when a reading type is not on or kun", () => {
    const bad = { ...valid, readings: [{ ...reading, type: "nanori" }] };
    expect(() => parseKanjiMnemonic(JSON.stringify(bad))).toThrow(/reading/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --workspace gen test -- parse.test.ts`

Expected: FAIL — `parseKanjiMnemonic is not a function`.

- [ ] **Step 3: Write the parser**

Append to `gen/src/parse.ts`:

```ts
// The model's wire shape for a kanji mnemonic. Sentences are flat here; the
// server nests them and adds furigana before storing.
export type KanjiMnemonicReadingRaw = {
  type: "on" | "kun";
  reading: string;
  sound_hook: string;
  scene: string;
  sentence_japanese: string;
  sentence_english: string;
  note?: string;
};

export type KanjiMnemonicRaw = {
  meaning: { gloss: string; scene: string; hook: string };
  readings: KanjiMnemonicReadingRaw[];
  recap: string[];
};

const MAX_READINGS = 4;

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function parseKanjiMnemonic(raw: string): KanjiMnemonicRaw {
  const parsed = JSON.parse(stripFences(raw));
  const m = parsed?.meaning;
  if (!nonEmpty(m?.gloss) || !nonEmpty(m?.scene) || !nonEmpty(m?.hook)) {
    throw new Error("kanji mnemonic response missing meaning fields");
  }
  if (!Array.isArray(parsed?.readings) || parsed.readings.length === 0) {
    throw new Error("kanji mnemonic response has no readings");
  }
  // Over-long lists are trimmed rather than rejected: five good readings is a
  // usable answer, just more than a card should show.
  const readings: KanjiMnemonicReadingRaw[] = parsed.readings
    .slice(0, MAX_READINGS)
    .map((r: Record<string, unknown>) => {
      if (
        (r?.type !== "on" && r?.type !== "kun") ||
        !nonEmpty(r?.reading) || !nonEmpty(r?.sound_hook) || !nonEmpty(r?.scene) ||
        !nonEmpty(r?.sentence_japanese) || !nonEmpty(r?.sentence_english)
      ) {
        throw new Error("kanji mnemonic reading missing required fields");
      }
      return {
        type: r.type,
        reading: r.reading as string,
        sound_hook: r.sound_hook as string,
        scene: r.scene as string,
        sentence_japanese: r.sentence_japanese as string,
        sentence_english: r.sentence_english as string,
        ...(nonEmpty(r?.note) ? { note: r.note as string } : {}),
      };
    });
  // recap restates what the readings already carry, so a model that skips it
  // has not failed.
  const recap = Array.isArray(parsed?.recap)
    ? parsed.recap.filter(nonEmpty).slice(0, 5)
    : [];
  return { meaning: { gloss: m.gloss, scene: m.scene, hook: m.hook }, readings, recap };
}
```

- [ ] **Step 4: Export it**

In `gen/src/index.ts`, add `parseKanjiMnemonic`, `type KanjiMnemonicRaw`, and `type KanjiMnemonicReadingRaw` to the existing `export { … } from "./parse.js";` list.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --workspace gen test -- parse.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add gen/src/parse.ts gen/src/parse.test.ts gen/src/index.ts
git commit -m "feat(kanji-mnemonics): parse mnemonic responses"
```

---

### Task 5: `gen` — the generator

**Files:**
- Modify: `gen/src/generate.ts`
- Modify: `gen/src/index.ts` (re-export)
- Test: `gen/src/generate.test.ts`

**Interfaces:**
- Consumes: `buildKanjiMnemonicPrompt` (Task 3), `parseKanjiMnemonic` / `KanjiMnemonicRaw` (Task 4), and the existing private `callWithRetry`.
- Produces:

```ts
export async function generateKanjiMnemonic(args: {
  character: string;
  meanings: string[];
  on: string[];
  kun: string[];
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ mnemonic: KanjiMnemonicRaw; usage: Usage; raw: string }>;
```

- [ ] **Step 1: Write the failing tests**

Append to `gen/src/generate.test.ts`. Add `generateKanjiMnemonic` to the import from `./generate.js`. The file already defines a `fakeClient(responses)` helper at the top (`generate.test.ts:8-17`) returning `{ client, create }` — reuse it rather than writing another:

```ts
describe("generateKanjiMnemonic", () => {
  const args = { character: "整", meanings: ["organize"], on: ["セイ"], kun: ["ととの.える"] };
  const body = {
    meaning: { gloss: "organize", scene: "A messy bundle beaten into shape.", hook: "messy bundle -> ORGANIZE" },
    readings: [{
      type: "on", reading: "セイ", sound_hook: "SAY",
      scene: "You shout SAY it looks good!",
      sentence_japanese: "部屋を整理しました。", sentence_english: "I organized the room.",
    }],
    recap: ["セイ -> SAY it looks good"],
  };

  it("returns the parsed mnemonic and the usage", async () => {
    const { client, create } = fakeClient([{ text: JSON.stringify(body), in: 120, out: 60 }]);
    const out = await generateKanjiMnemonic({ ...args, client });
    expect(out.mnemonic.readings[0].sound_hook).toBe("SAY");
    expect(out.usage).toEqual({ input_tokens: 120, output_tokens: 60 });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![0].messages[0].content).toContain("整");
  });

  it("returns a deterministic fixture when NIHONGO_FAKE_AI=1", async () => {
    const prev = process.env.NIHONGO_FAKE_AI;
    process.env.NIHONGO_FAKE_AI = "1";
    try {
      const out = await generateKanjiMnemonic(args);
      expect(out.mnemonic.readings.length).toBeGreaterThan(0);
      expect(out.mnemonic.meaning.gloss.length).toBeGreaterThan(0);
      expect(out.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
    } finally {
      if (prev === undefined) delete process.env.NIHONGO_FAKE_AI;
      else process.env.NIHONGO_FAKE_AI = prev;
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --workspace gen test -- generate.test.ts`

Expected: FAIL — `generateKanjiMnemonic is not a function`.

- [ ] **Step 3: Write the generator**

In `gen/src/generate.ts`, add `buildKanjiMnemonicPrompt` to the import from `./prompt.js`, add `parseKanjiMnemonic` and `type KanjiMnemonicRaw` to the import from `./parse.js`, add `KanjiMnemonicRaw` to the `export type { … }` line, then append near the other single-object generators:

```ts
const KANJI_MNEMONIC_FAKE: KanjiMnemonicRaw = {
  meaning: {
    gloss: "eat, food",
    scene: "A person ducks under a roof and inhales a whole bowl of rice.",
    hook: "person under a roof + rice -> EAT",
  },
  readings: [
    {
      type: "on",
      reading: "ショク",
      sound_hook: "SHOCK",
      scene: "You take one bite and the flavour is a SHOCK — you eat the whole table.",
      sentence_japanese: "毎日、食事をします。",
      sentence_english: "I have meals every day.",
    },
    {
      type: "kun",
      reading: "た.べる",
      sound_hook: "TA-BELL",
      scene: "A dinner BELL rings and everyone runs to eat.",
      sentence_japanese: "りんごを食べます。",
      sentence_english: "I eat an apple.",
    },
  ],
  recap: ["ショク -> SHOCK, the flavour", "たべる -> TA-BELL rings, time to eat"],
};

export async function generateKanjiMnemonic(args: {
  character: string;
  meanings: string[];
  on: string[];
  kun: string[];
  client?: ClientLike;
  signal?: AbortSignal;
}): Promise<{ mnemonic: KanjiMnemonicRaw; usage: Usage; raw: string }> {
  if (process.env.NIHONGO_FAKE_AI === "1") {
    return {
      mnemonic: KANJI_MNEMONIC_FAKE,
      usage: { input_tokens: 0, output_tokens: 0 },
      raw: JSON.stringify(KANJI_MNEMONIC_FAKE),
    };
  }
  const { system, user } = buildKanjiMnemonicPrompt({
    character: args.character, meanings: args.meanings, on: args.on, kun: args.kun,
  });
  const client = (args.client ?? new Anthropic()) as ClientLike;
  const { value, usage, raw } = await callWithRetry<KanjiMnemonicRaw>({
    system, user, parse: parseKanjiMnemonic, client, signal: args.signal,
  });
  return { mnemonic: value, usage, raw };
}
```

- [ ] **Step 4: Export it**

In `gen/src/index.ts`, add `generateKanjiMnemonic` to the existing `export { … } from "./generate.js";` list.

- [ ] **Step 5: Run the full gen suite**

Run: `npm --workspace gen test`

Expected: PASS, all files.

- [ ] **Step 6: Commit**

```bash
git add gen/src/generate.ts gen/src/generate.test.ts gen/src/index.ts
git commit -m "feat(kanji-mnemonics): add generateKanjiMnemonic"
```

---

### Task 6: Server service — get-or-generate

**Files:**
- Create: `server/src/services/kanji-mnemonic.ts`
- Test: `server/src/services/kanji-mnemonic.test.ts`

**Interfaces:**
- Consumes: `generateKanjiMnemonic`, `toRubyHtml`, `computeCost`, `MODEL` from `@nihongo/gen`; `KanjiMnemonic` from `@nihongo/shared`; `pool` from `../db/pool.js`; the `kanji_mnemonics` table (Task 1).
- Produces:

```ts
export class KanjiNotFoundError extends Error {}
export async function getKanjiMnemonic(character: string): Promise<KanjiMnemonic>;
export async function regenerateKanjiMnemonic(character: string): Promise<KanjiMnemonic>;
```

- [ ] **Step 1: Write the failing tests**

Create `server/src/services/kanji-mnemonic.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { pool } from "../db/pool.js";
import { resetDb } from "../db/reset.js";
import { getKanjiMnemonic, regenerateKanjiMnemonic, KanjiNotFoundError } from "./kanji-mnemonic.js";

async function insertShoku(): Promise<void> {
  await pool.query(
    `INSERT INTO kanji (character, strokes, stroke_count, meanings, on_yomi, kun_yomi)
     VALUES ('食', '["a"]', 1, ARRAY['eat','food'], ARRAY['ショク'], ARRAY['た.べる'])`,
  );
}

beforeEach(async () => {
  await resetDb();
  process.env.NIHONGO_FAKE_AI = "1";
});
afterEach(() => {
  delete process.env.NIHONGO_FAKE_AI;
});

describe("getKanjiMnemonic", () => {
  it("throws KanjiNotFoundError for a character not in the reference table", async () => {
    await expect(getKanjiMnemonic("猫")).rejects.toBeInstanceOf(KanjiNotFoundError);
  });

  it("generates, ruby-annotates and stores on a cache miss", async () => {
    await insertShoku();
    const m = await getKanjiMnemonic("食");

    expect(m.character).toBe("食");
    expect(m.readings.length).toBeGreaterThan(0);
    expect(m.readings[0].sentence.jp_ruby).toContain("<ruby>");
    expect(m.readings[0].sentence.jp_ruby).toContain("<rt>");

    const row = await pool.query(`SELECT content, model, cost_usd FROM kanji_mnemonics WHERE character = '食'`);
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].model.length).toBeGreaterThan(0);
    expect(Number(row.rows[0].cost_usd)).toBe(0); // fake AI reports zero usage
  });

  it("returns the cached row without regenerating", async () => {
    await insertShoku();
    await getKanjiMnemonic("食");
    await pool.query(
      `UPDATE kanji_mnemonics
          SET content = jsonb_set(content, '{meaning,gloss}', '"EDITED"')
        WHERE character = '食'`,
    );
    const again = await getKanjiMnemonic("食");
    expect(again.meaning.gloss).toBe("EDITED");
  });

  it("stores one row when two callers race", async () => {
    await insertShoku();
    const [a, b] = await Promise.all([getKanjiMnemonic("食"), getKanjiMnemonic("食")]);
    const count = await pool.query(`SELECT count(*)::int AS c FROM kanji_mnemonics WHERE character = '食'`);
    expect(count.rows[0].c).toBe(1);
    expect(a).toEqual(b);
  });
});

describe("regenerateKanjiMnemonic", () => {
  it("replaces the cached row", async () => {
    await insertShoku();
    await getKanjiMnemonic("食");
    await pool.query(
      `UPDATE kanji_mnemonics
          SET content = jsonb_set(content, '{meaning,gloss}', '"STALE"')
        WHERE character = '食'`,
    );
    const fresh = await regenerateKanjiMnemonic("食");
    expect(fresh.meaning.gloss).not.toBe("STALE");
    const count = await pool.query(`SELECT count(*)::int AS c FROM kanji_mnemonics WHERE character = '食'`);
    expect(count.rows[0].c).toBe(1);
  });

  it("throws KanjiNotFoundError for an unknown character", async () => {
    await expect(regenerateKanjiMnemonic("猫")).rejects.toBeInstanceOf(KanjiNotFoundError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --workspace server test -- kanji-mnemonic.test.ts`

Expected: FAIL — cannot resolve `./kanji-mnemonic.js`.

- [ ] **Step 3: Write the service**

Create `server/src/services/kanji-mnemonic.ts`:

```ts
import { pool } from "../db/pool.js";
import { generateKanjiMnemonic, toRubyHtml, computeCost, MODEL } from "@nihongo/gen";
import type { KanjiMnemonic } from "@nihongo/shared";

// Lazy per-character mnemonic cache. Generation is triggered by a learner
// opening the Mnemonic tab, so it costs about a cent only for the kanji they
// actually wanted help with.

export class KanjiNotFoundError extends Error {
  constructor(character: string) {
    super(`kanji not found: ${character}`);
    this.name = "KanjiNotFoundError";
  }
}

async function readCached(character: string): Promise<KanjiMnemonic | null> {
  const res = await pool.query<{ content: KanjiMnemonic }>(
    `SELECT content FROM kanji_mnemonics WHERE character = $1`,
    [character],
  );
  return res.rows[0]?.content ?? null;
}

type RefRow = { meanings: string[]; on_yomi: string[]; kun_yomi: string[] };

// Generate + store. Returns whatever row ends up in the table, so two callers
// racing on the same character both get the single stored mnemonic. Losing that
// race wastes a cent of tokens, which is cheaper than locking to prevent it.
async function generateAndStore(character: string): Promise<KanjiMnemonic> {
  const ref = await pool.query<RefRow>(
    `SELECT meanings, on_yomi, kun_yomi FROM kanji WHERE character = $1`,
    [character],
  );
  const row = ref.rows[0];
  if (!row) throw new KanjiNotFoundError(character);

  const { mnemonic, usage } = await generateKanjiMnemonic({
    character,
    meanings: row.meanings,
    on: row.on_yomi,
    kun: row.kun_yomi,
  });

  const readings = await Promise.all(
    mnemonic.readings.map(async (r) => ({
      type: r.type,
      reading: r.reading,
      sound_hook: r.sound_hook,
      scene: r.scene,
      sentence: {
        jp: r.sentence_japanese,
        jp_ruby: await toRubyHtml(r.sentence_japanese),
        en: r.sentence_english,
      },
      ...(r.note ? { note: r.note } : {}),
    })),
  );

  // `character` comes from the request, never from the model response — an
  // echoed wrong glyph must not become the cache key.
  const content: KanjiMnemonic = {
    character,
    meaning: mnemonic.meaning,
    readings,
    recap: mnemonic.recap,
  };

  await pool.query(
    `INSERT INTO kanji_mnemonics (character, content, model, cost_usd)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (character) DO NOTHING`,
    [character, JSON.stringify(content), MODEL, computeCost(usage)],
  );

  const stored = await readCached(character);
  return stored ?? content;
}

export async function getKanjiMnemonic(character: string): Promise<KanjiMnemonic> {
  const cached = await readCached(character);
  if (cached) return cached;
  return generateAndStore(character);
}

// Deletes first, so a regeneration that fails leaves no mnemonic rather than a
// stale one the learner already rejected — the next open tries again.
export async function regenerateKanjiMnemonic(character: string): Promise<KanjiMnemonic> {
  await pool.query(`DELETE FROM kanji_mnemonics WHERE character = $1`, [character]);
  return generateAndStore(character);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --workspace server test -- kanji-mnemonic.test.ts`

Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/kanji-mnemonic.ts server/src/services/kanji-mnemonic.test.ts
git commit -m "feat(kanji-mnemonics): get-or-generate mnemonic service"
```

---

### Task 7: Server routes

**Files:**
- Modify: `server/src/routes/kanji.ts`
- Test: `server/src/routes/kanji.test.ts`

**Interfaces:**
- Consumes: `getKanjiMnemonic`, `regenerateKanjiMnemonic`, `KanjiNotFoundError` (Task 6).
- Produces: `GET /api/kanji/:character/mnemonic` and `POST /api/kanji/:character/mnemonic/regenerate`, both returning a `KanjiMnemonic` JSON body.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/routes/kanji.test.ts` (it already defines `PASSCODE`, `app`, `insertKanji` and a `beforeEach(() => resetDb())` — reuse them; add `afterEach` to the vitest import if it is not there):

```ts
describe("kanji mnemonics", () => {
  beforeEach(() => { process.env.NIHONGO_FAKE_AI = "1"; });
  afterEach(() => { delete process.env.NIHONGO_FAKE_AI; });

  it("requires passcode", async () => {
    const res = await request(app).get("/api/kanji/%E9%A3%9F/mnemonic");
    expect(res.status).toBe(401);
  });

  it("returns a mnemonic with ruby-annotated sentences", async () => {
    await insertKanji({ character: "食", strokes: ["a"], meanings: ["eat"], on: ["ショク"], kun: ["た.べる"] });
    const res = await request(app)
      .get(`/api/kanji/${encodeURIComponent("食")}/mnemonic`)
      .set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.character).toBe("食");
    expect(res.body.meaning.hook.length).toBeGreaterThan(0);
    expect(res.body.readings[0].sentence.jp_ruby).toContain("<ruby>");
  });

  it("404s for a character with no reference row", async () => {
    const res = await request(app)
      .get(`/api/kanji/${encodeURIComponent("猫")}/mnemonic`)
      .set("X-Passcode", PASSCODE);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("KANJI_NOT_FOUND");
  });

  it("regenerate replaces the stored mnemonic", async () => {
    await insertKanji({ character: "食", strokes: ["a"], meanings: ["eat"], on: ["ショク"], kun: ["た.べる"] });
    await request(app).get(`/api/kanji/${encodeURIComponent("食")}/mnemonic`).set("X-Passcode", PASSCODE);
    await pool.query(
      `UPDATE kanji_mnemonics SET content = jsonb_set(content, '{meaning,gloss}', '"STALE"') WHERE character = '食'`,
    );
    const res = await request(app)
      .post(`/api/kanji/${encodeURIComponent("食")}/mnemonic/regenerate`)
      .set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.meaning.gloss).not.toBe("STALE");
  });

  it("still serves the plain detail route", async () => {
    await insertKanji({ character: "食", strokes: ["a", "b"], meanings: ["eat"] });
    const res = await request(app)
      .get(`/api/kanji/${encodeURIComponent("食")}`)
      .set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.strokes).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --workspace server test -- routes/kanji.test.ts`

Expected: FAIL — the mnemonic requests 404 with the existing `KANJI_NOT_FOUND` from the detail route, or return HTML, because no handler exists yet.

- [ ] **Step 3: Add the routes**

In `server/src/routes/kanji.ts`, extend the service import and insert both handlers **above** the existing `kanjiRouter.get("/:character", …)` handler:

```ts
import { getKanjiMnemonic, regenerateKanjiMnemonic, KanjiNotFoundError } from "../services/kanji-mnemonic.js";
```

```ts
// GET /api/kanji/:character/mnemonic — cached memory aid, generated on first
// ask. Declared before /:character; that route matches a single segment, so the
// two do not collide, but the specific one stays first by habit.
kanjiRouter.get("/:character/mnemonic", async (req, res) => {
  try {
    res.json(await getKanjiMnemonic(req.params.character));
  } catch (err) {
    sendMnemonicError(res, err);
  }
});

// POST /api/kanji/:character/mnemonic/regenerate — throw this one away and
// write a fresh one. The escape hatch for a mnemonic that lands flat.
kanjiRouter.post("/:character/mnemonic/regenerate", async (req, res) => {
  try {
    res.json(await regenerateKanjiMnemonic(req.params.character));
  } catch (err) {
    sendMnemonicError(res, err);
  }
});

function sendMnemonicError(res: Response, err: unknown): void {
  if (err instanceof KanjiNotFoundError) {
    res.status(404).json({ error: "kanji not found", code: "KANJI_NOT_FOUND" });
    return;
  }
  console.error("kanji mnemonic generation failed", err);
  res.status(502).json({ error: "could not write a mnemonic", code: "MNEMONIC_FAILED" });
}
```

Add `Response` to the existing `express` import: `import { Router, type Response } from "express";`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --workspace server test -- routes/kanji.test.ts`

Expected: PASS, including the pre-existing browse and detail tests.

- [ ] **Step 5: Run the whole server suite for regressions**

Run: `npm --workspace server test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/kanji.ts server/src/routes/kanji.test.ts
git commit -m "feat(kanji-mnemonics): add mnemonic and regenerate endpoints"
```

---

### Task 8: Client API helpers

**Files:**
- Modify: `client/src/api-hooks.ts` (the `// ----- Kanji -----` block, around lines 147–158)

**Interfaces:**
- Consumes: `KanjiMnemonic` from `@nihongo/shared`; the existing private `api<T>()` helper, which attaches the passcode and throws on non-2xx.
- Produces:

```ts
export function fetchKanjiMnemonic(character: string): Promise<KanjiMnemonic>;
export function regenerateKanjiMnemonic(character: string): Promise<KanjiMnemonic>;
```

- [ ] **Step 1: Add the helpers**

Add `KanjiMnemonic` to the existing type import at the top of the file (the one that already brings in `KanjiDetail`), then append to the `// ----- Kanji -----` block, after `fetchKanji`:

```ts
export function fetchKanjiMnemonic(character: string): Promise<KanjiMnemonic> {
  return api<KanjiMnemonic>(`/api/kanji/${encodeURIComponent(character)}/mnemonic`);
}

export function regenerateKanjiMnemonic(character: string): Promise<KanjiMnemonic> {
  return api<KanjiMnemonic>(
    `/api/kanji/${encodeURIComponent(character)}/mnemonic/regenerate`,
    { method: "POST" },
  );
}
```

`api` is imported from `./api` and is `api<T>(path: string, init: RequestInit = {})` (`client/src/api.ts:12`), so passing `{ method: "POST" }` as the second argument is correct — it attaches the passcode header and throws on a non-2xx response.

- [ ] **Step 2: Verify the client type-checks**

Run: `npm --workspace client run build`

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/api-hooks.ts
git commit -m "feat(kanji-mnemonics): client api helpers"
```

---

### Task 9: `KanjiMnemonicCard` component

**Files:**
- Create: `client/src/components/KanjiMnemonicCard.tsx`
- Modify: `client/src/styles/screens.css` (after the `.kanji-draw__*` rules, around line 818)

**Interfaces:**
- Consumes: `fetchKanjiMnemonic`, `regenerateKanjiMnemonic` (Task 8); `KanjiMnemonic` type (Task 2); the existing `RubyText` component, which takes `{ html: string; className?: string }` and sanitizes the markup through `sanitizeRuby` before setting it (`client/src/components/RubyText.tsx:8-10`).
- Produces: `export function KanjiMnemonicCard({ character }: { character: string })`, used by Task 10.

- [ ] **Step 1: Write the component**

Create `client/src/components/KanjiMnemonicCard.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { KanjiMnemonic } from "@nihongo/shared";
import { fetchKanjiMnemonic, regenerateKanjiMnemonic } from "../api-hooks";
import { RubyText } from "./RubyText";

type Props = { character: string };

// The memory-aid face of a kanji card: one absurd scene for the meaning, then
// per reading an English sound hook, a mini-story, and a real sentence.
//
// Fetching on mount is deliberate — this component only mounts when the learner
// selects the Mnemonic tab, and the server generates on first ask, so nothing is
// spent on kanji nobody wanted help with.
export function KanjiMnemonicCard({ character }: Props) {
  const [mnemonic, setMnemonic] = useState<KanjiMnemonic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMnemonic(null);
    setError(null);
    fetchKanjiMnemonic(character)
      .then((m) => { if (!cancelled) setMnemonic(m); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "load failed"); });
    return () => { cancelled = true; };
  }, [character]);

  async function tryAnother() {
    setBusy(true);
    setError(null);
    try {
      setMnemonic(await regenerateKanjiMnemonic(character));
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not write another");
    } finally {
      setBusy(false);
    }
  }

  if (error && !mnemonic) {
    return (
      <div className="kanji-mnemonic">
        <p className="kanji-mnemonic__error">Couldn’t write a mnemonic for this one.</p>
        <button type="button" className="kanji-mnemonic__retry" onClick={tryAnother} disabled={busy}>
          {busy ? "Trying…" : "Try again"}
        </button>
      </div>
    );
  }

  if (!mnemonic) {
    return (
      <div className="kanji-mnemonic">
        <p className="kanji-mnemonic__loading">Writing a mnemonic…</p>
      </div>
    );
  }

  return (
    <div className="kanji-mnemonic">
      <section className="kanji-mnemonic__meaning">
        <p className="kanji-mnemonic__gloss">{mnemonic.meaning.gloss}</p>
        <p className="kanji-mnemonic__scene">{mnemonic.meaning.scene}</p>
        <p className="kanji-mnemonic__hook">{mnemonic.meaning.hook}</p>
      </section>

      {mnemonic.readings.map((r) => (
        <section className="kanji-mnemonic__reading" key={`${r.type}-${r.reading}`}>
          <p className="kanji-mnemonic__hookline">
            <span className="kanji-mnemonic__reading-jp">{r.reading}</span>
            <span className="kanji-mnemonic__arrow">→</span>
            <span className="kanji-mnemonic__sound">{r.sound_hook}</span>
            <span className="kanji-mnemonic__type">{r.type === "on" ? "on’yomi" : "kun’yomi"}</span>
          </p>
          <p className="kanji-mnemonic__scene">{r.scene}</p>
          <div className="kanji-mnemonic__sentence">
            <RubyText html={r.sentence.jp_ruby} className="kanji-mnemonic__jp" />
            <p className="kanji-mnemonic__en">{r.sentence.en}</p>
          </div>
          {r.note && <p className="kanji-mnemonic__note">{r.note}</p>}
        </section>
      ))}

      {mnemonic.recap.length > 0 && (
        <ul className="kanji-mnemonic__recap">
          {mnemonic.recap.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}

      <button type="button" className="kanji-mnemonic__retry" onClick={tryAnother} disabled={busy}>
        {busy ? "Writing another…" : "Try another"}
      </button>
      {error && <p className="kanji-mnemonic__error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Add the styles**

Append to `client/src/styles/screens.css`, after the `.kanji-draw__*` rules (around line 818), matching that file's single-line rule style. Every token used below is already defined in `client/src/styles/tokens.css`: `--bg-sunken` (63), `--border` (64), `--fg-tertiary` (68), `--accent` (69), `--font-ui` (108), `--radius-lg` (126).

```css
.kanji-mnemonic { display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 340px; align-self: center; text-align: left; overflow-y: auto; }
.kanji-mnemonic__loading, .kanji-mnemonic__error { font-family: var(--font-ui); font-size: 13px; color: var(--fg-tertiary); text-align: center; }
.kanji-mnemonic__gloss { font-family: var(--font-ui); font-size: 16px; font-weight: 600; }
.kanji-mnemonic__scene { font-size: 15px; line-height: 1.5; }
.kanji-mnemonic__hook { font-family: var(--font-ui); font-size: 13px; font-weight: 600; letter-spacing: 0.02em; padding: 8px 10px; border-radius: var(--radius-lg); background: var(--bg-sunken); }
.kanji-mnemonic__reading { display: flex; flex-direction: column; gap: 6px; padding-top: 12px; border-top: 1px solid var(--border); }
.kanji-mnemonic__hookline { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.kanji-mnemonic__reading-jp { font-size: 18px; }
.kanji-mnemonic__arrow, .kanji-mnemonic__type { color: var(--fg-tertiary); font-family: var(--font-ui); font-size: 12px; }
.kanji-mnemonic__sound { font-family: var(--font-ui); font-size: 15px; font-weight: 700; letter-spacing: 0.04em; }
.kanji-mnemonic__sentence { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: var(--radius-lg); background: var(--bg-sunken); }
.kanji-mnemonic__jp { font-size: 17px; }
.kanji-mnemonic__en { font-family: var(--font-ui); font-size: 13px; color: var(--fg-tertiary); }
.kanji-mnemonic__note { font-family: var(--font-ui); font-size: 12px; color: var(--fg-tertiary); }
.kanji-mnemonic__recap { display: flex; flex-direction: column; gap: 3px; font-family: var(--font-ui); font-size: 12px; color: var(--fg-tertiary); list-style: none; padding: 0; }
.kanji-mnemonic__retry { align-self: center; font-family: var(--font-ui); font-size: 12px; color: var(--fg-tertiary); padding: 6px 14px; border: 1px solid var(--border); border-radius: 999px; background: none; }
.kanji-mnemonic__retry:disabled { opacity: 0.5; }
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm --workspace client run build`

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/KanjiMnemonicCard.tsx client/src/styles/screens.css
git commit -m "feat(kanji-mnemonics): add KanjiMnemonicCard"
```

---

### Task 10: Wire the third tab into `KanjiCard`

**Files:**
- Modify: `client/src/components/KanjiCard.tsx`

**Interfaces:**
- Consumes: `KanjiMnemonicCard` (Task 9).
- Produces: a `Mnemonic` tab (`role="tab"`, accessible name `Mnemonic`) that the e2e test in Task 11 drives.

- [ ] **Step 1: Add the mode**

In `client/src/components/KanjiCard.tsx`:

1. Import the component: `import { KanjiMnemonicCard } from "./KanjiMnemonicCard";`
2. Widen the mode type: `type Mode = "recognize" | "draw" | "mnemonic";`
3. Add a third button inside the existing `.kanji-mode` tablist, after the Draw button, copying the Draw button's shape exactly:

```tsx
<button
  type="button"
  role="tab"
  aria-selected={mode === "mnemonic"}
  className={`kanji-mode__btn ${mode === "mnemonic" ? "is-active" : ""}`}
  onClick={() => setMode("mnemonic")}
>
  Mnemonic
</button>
```

4. Replace the two-branch render with three. The recognize branch is unchanged; the trailing `: (` draw branch becomes:

```tsx
) : mode === "draw" ? (
  <KanjiDrawCard
    character={p.character}
    meaning={meaning}
    reading={readings || null}
    onAnswer={onAnswer}
  />
) : (
  <KanjiMnemonicCard character={p.character} />
)}
```

5. Leave `canSwipe={mode === "recognize" && flipped}` exactly as it is — the mnemonic tab must not grade by swipe, same as Draw.

- [ ] **Step 2: Verify it type-checks**

Run: `npm --workspace client run build`

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/KanjiCard.tsx
git commit -m "feat(kanji-mnemonics): add Mnemonic tab to the kanji card"
```

---

### Task 11: End-to-end test

**Files:**
- Modify: `e2e/tests/kanji.spec.ts`

**Interfaces:**
- Consumes: the whole stack. CI runs e2e with `NIHONGO_FAKE_AI: "1"` (`.github/workflows/ci.yml:58`), so the real lazy-generation path runs against the deterministic fixture from Task 5 — no API key, no seeded mnemonic row.
- Produces: coverage that opening the tab generates, stores and renders a mnemonic.

- [ ] **Step 1: Write the failing test**

Append to `e2e/tests/kanji.spec.ts`. The existing `beforeEach` already loads `seed-test-kanji`, which seeds 食 — the same character the fake mnemonic describes:

```ts
test("kanji: the mnemonic tab writes and shows a memory aid", async ({ page }) => {
  await login(page);
  await practiceSkill(page, "kanji");

  await page.getByRole("tab", { name: "Mnemonic" }).click();

  // Meaning scene + the replay hook.
  await expect(page.locator(".kanji-mnemonic__gloss")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".kanji-mnemonic__hook")).toBeVisible();

  // Per-reading: sound hook and a ruby-annotated example sentence.
  await expect(page.locator(".kanji-mnemonic__sound").first()).toBeVisible();
  await expect(page.locator(".kanji-mnemonic__jp ruby").first()).toBeVisible();
  await expect(page.locator(".kanji-mnemonic__en").first()).toBeVisible();

  // Swiping must not grade from this tab: the card is still here afterwards.
  await expect(page.locator(".kanji-mnemonic")).toBeVisible();

  // Back to Recognize, and normal grading still works.
  await page.getByRole("tab", { name: "Recognize" }).click();
  await page.getByRole("button", { name: /Tap to reveal/i }).click();
  await page.getByRole("button", { name: /Got it/i }).click();
  await expect(page.locator(POST_GRADE).first()).toBeVisible();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Start the stack the way the repo normally does for e2e (see `README.md` / `.github/workflows/ci.yml:36-74` — Postgres up, migrations applied, server and client running, `NIHONGO_FAKE_AI=1`, `DATABASE_URL` set), then:

Run: `npm --workspace e2e test -- kanji.spec.ts`

Expected: PASS, since Tasks 9–10 have already landed. Confirm the assertions are real rather than vacuous: temporarily change the tab label in `KanjiCard.tsx` to `Mnemonics`, re-run, watch this test fail on the missing tab, then change it back.

- [ ] **Step 3: Verify the mnemonic was actually persisted**

Run: `psql "$DATABASE_URL" -c "SELECT character, model, cost_usd FROM kanji_mnemonics"`

Expected: one row for 食. Cost is 0 because the fake generator reports zero usage.

- [ ] **Step 4: Run the full e2e suite for regressions**

Run: `npm --workspace e2e test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/tests/kanji.spec.ts
git commit -m "test(kanji-mnemonics): e2e coverage for the mnemonic tab"
```

---

### Task 12: Full verification and live check

**Files:** none — verification only.

- [ ] **Step 1: Run every workspace suite**

Run: `npm test`

Expected: PASS across shared, gen, server, client. Paste the real output; do not claim a pass you have not seen.

- [ ] **Step 2: Build everything**

Run: `npm run build`

Expected: exits 0.

- [ ] **Step 3: Check a real generation once, against the live model**

With a real `ANTHROPIC_API_KEY` and **without** `NIHONGO_FAKE_AI`, start the app, practice a kanji, and open the Mnemonic tab. Confirm: the scene is vivid rather than an etymology lecture, each reading has an English sound hook, each sentence contains the kanji and uses that reading, and "Try another" produces a different mnemonic.

Then confirm the cost landed:

Run: `psql "$DATABASE_URL" -c "SELECT character, model, cost_usd, generated_at FROM kanji_mnemonics ORDER BY generated_at DESC LIMIT 5"`

Expected: a row per kanji you opened, `cost_usd` around 0.01.

- [ ] **Step 4: Deploy the branch to exe.dev and test on a phone**

The Mnemonic tab is a scrolling panel inside a swipeable card on a narrow screen; that combination only really proves out on the device. Deploy `feat/kanji-mnemonics` to exe.dev and check the tab scrolls, the sentences wrap, and swiping inside the panel does not grade the card.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/kanji-mnemonics
gh pr create --title "feat: kanji mnemonics" --body "Closes #23"
```

---

## Notes for the implementer

**Why lazy and not a backfill.** Generating all ~2,136 jōyō kanji up front is about $25 of mnemonics for characters that may not come up for months. On-demand costs about a cent each, only for characters the learner opened the tab on. If a backfill is ever wanted it is a small script looping `getKanjiMnemonic` — the service is already the right seam. Do not add it as part of this plan.

**Why the tab spoils the answer.** Opening Mnemonic before flipping reveals the meaning. That is already true of Draw mode, which is handed `meaning` and `reading` as props (`KanjiCard.tsx:88-91`). Following the existing behaviour beats inventing a guard for one tab.

**Two shapes, one concept.** `KanjiMnemonicRaw` (in `gen`) is the model's wire format with flat `sentence_japanese` / `sentence_english`. `KanjiMnemonic` (in `shared`) is the stored and served format, with a nested `sentence` object carrying `jp_ruby`. The service in Task 6 is the only place that converts between them. Do not collapse them.
