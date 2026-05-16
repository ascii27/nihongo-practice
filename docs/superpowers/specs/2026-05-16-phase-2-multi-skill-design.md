# Phase 2 — Multi-Skill Expansion + Dashboard

**Date:** 2026-05-16
**Status:** Draft — awaiting owner review
**Owner:** michael.roy.galloway@gmail.com
**Parent spec:** [`2026-05-04-nihongo-practice-design.md`](./2026-05-04-nihongo-practice-design.md)
**Predecessors:** Phase 1 (vocab loop), Phase 1.5 (AI top-up)

## Goal

Expand the app from vocab-only to all five skills from the parent spec — grammar, reading comprehension, verb conjugation, particle usage — and replace the current Today screen with a dashboard the owner uses as the primary entry point. From the dashboard the owner picks a skill (or "mixed practice") and enters a session targeted at that skill.

After Phase 2, "the app" is no longer a vocab drill app; it's a Japanese practice app with five drill modes.

## Non-goals

- Cross-skill weakness inference (e.g. "you keep missing で-particle items, generate more"). Free-form `weakness_hint` already covers manual nudges.
- Audio prompts or pronunciation drills.
- Manual editing of items in the UI (deferred to a later Phase 2.5 / Phase 3 — the Browse screen already lets you list items but not edit).
- Sub-skill taxonomy (e.g. grouping grammar by JLPT level). Tags exist on the `items` row but no UI consumes them yet; let that arrive when there's a concrete need.
- Multi-card-per-session mixing rules beyond "due first by `next_review_at`, then new". Existing queue logic.
- A custom Japanese keyboard. Conjugation accepts whatever the iOS IME produces.

## Architecture summary

The data layer is already multi-skill: `items.skill` has a CHECK constraint that allows all five values, the Leitner SRS is skill-agnostic, and `/api/queue?skill=X` already supports filtering. The work is concentrated in:

1. **Per-skill content generation** — extend `@nihongo/gen` with four new prompt builders + parsers, and generalize `/api/generate` so it routes by skill.
2. **Per-skill card components** — keep `<FlipCard>` for vocab/grammar/reading, add `<MultipleChoiceCard>` for particle, add `<TypedInputCard>` for conjugation.
3. **Dashboard screen** — replaces TodayScreen as the entry route. Per-skill cards with due counts; a "mixed practice" CTA at top; per-skill "Generate more" affordances when a skill is empty.
4. **Per-skill stats** — `/api/stats` returns one block per skill, the Stats screen shows them.

```
gen/src/
  prompt.ts          + buildGrammarPrompt, buildReadingPrompt,
                       buildConjugationPrompt, buildParticlePrompt
  parse.ts           + parseGrammarBatch, parseReadingBatch,
                       parseConjugationBatch, parseParticleBatch
  generate.ts        + generateGrammarBatch, generateReadingBatch,
                       generateConjugationBatch, generateParticleBatch
                       (all wrap the existing callWithRetry driver)

server/src/
  services/generate.ts   refactor runVocabGeneration → runGeneration({skill, ...})
                         routes by skill to the right gen fn + parser

client/src/
  screens/DashboardScreen.tsx          new — replaces TodayScreen entrypoint
  components/MultipleChoiceCard.tsx    new
  components/TypedInputCard.tsx        new
  components/FlipCard.tsx              extended — variants per skill
  screens/PracticeScreen.tsx           dispatches to the right card by skill
  components/GenerateForm.tsx          extended — skill picker dropdown
```

## Skill-by-skill design

For each skill: **prompt/answer shape** (locked by parent spec), **card UX**, **generation prompt**, **grading**, **seed strategy**, **edge cases**.

### Grammar

> *Recognize what a sentence pattern means.*

**Prompt/answer shape** (from parent spec):

```ts
prompt: { sentence_ruby: string; pattern: string; sentence_english: string }
answer: { explanation: string; another_example_ruby?: string }
```

**Card UX** — `<FlipCard>` with grammar variant. Prompt face: the sentence with ruby, the **pattern label in a chip below the sentence** (e.g., `〜ながら`), the English translation. Answer face: the explanation, optionally a second example sentence. Self-grade "Got it / Missed".

**Generation prompt** — `buildGrammarPrompt({ count, weakness_hint? })` asks Claude for N items, each containing a target pattern, a natural example sentence using it, the English translation, and a 1–2 sentence explanation suitable for an intermediate learner. The user prompt encourages variety across the batch (different patterns).

**Grading** — self-grade. The "answer" is interpretive; binary correct/incorrect isn't appropriate.

**Seed strategy** — AI-generated from empty. No manual seed list; the owner generates the first batch from the dashboard's empty-state. (Hand-curated seeds can land later if needed.)

**Edge cases** — Claude may include the pattern verbatim inside `sentence_english` ("…using the て-form…"). Fine. The parser strict-validates the four required fields; we don't try to detect this.

### Reading comprehension

> *Read a short passage, answer one question.*

**Prompt/answer shape**:

```ts
prompt: { passage_ruby: string; question_english: string }
answer: { answer_english: string; answer_japanese_ruby?: string }
```

**Card UX** — `<FlipCard>` with reading variant. Prompt face: the passage (multi-paragraph, larger ruby), the question below. Answer face: the English answer (always present) and the Japanese answer with ruby (optional, when natural). Self-grade.

A reading passage is longer than a vocab sentence — visually the card grows taller. On iPhone we may want to scroll within the card; tab bar stays at the bottom. Use the existing `screen--practice` layout but allow card content scrolling.

**Generation prompt** — `buildReadingPrompt({ count, weakness_hint? })`: N items, each a 3–5 sentence beginner-intermediate Japanese passage, one English comprehension question that requires inference (not just lookup), and a 1-sentence English answer.

**Grading** — self-grade.

**Seed strategy** — AI-generated.

**Edge cases** — Claude may produce passages too long (>5 sentences). The parser doesn't enforce length, but the system prompt asks for short passages and we trust it. If batches come back too long, tune the prompt.

### Verb conjugation

> *Type the conjugated form of a base verb.*

**Prompt/answer shape**:

```ts
prompt: { base: string; base_ruby: string; tense: string }   // tense: e.g. "past polite negative"
answer: { expected: string; expected_ruby: string; alternates?: string[] }
```

**Card UX** — `<TypedInputCard>`, new component. Prompt face: the base verb with ruby (e.g., 食べる), the requested tense as a label/chip (e.g., "past polite negative"), an input field with the user's keyboard. Below the input, two buttons: **Submit** (primary) and **Skip / Reveal** (secondary).

On submit: server normalizes (NFKC + katakana→hiragana) and compares to `expected` and any `alternates`. Auto-grade green/red, reveal the expected form with ruby. Then the user can override: **Got it** / **Missed** (defaults match the auto-grade).

Why self-override? Conjugation has acceptable variants (formal vs casual ます-stem, polite negative ません vs ない+です, etc.) and our seed will miss some. Owner shouldn't get penalized for valid alternates we didn't list.

**Generation prompt** — `buildConjugationPrompt({ count, weakness_hint? })`: N items varying base verb (mix of regular ichidan, regular godan, irregular する/くる) and tense (te-form, past polite, past plain, negative polite, negative plain, potential, passive, causative, ば conditional, たら conditional, volitional). Output includes `expected`, `expected_ruby`, and a list of `alternates` for known acceptable variants.

**Grading** — server-side exact match after normalization, but client-side self-override always wins. The submitted text is sent in the `/api/reviews` payload for forensic logging (need to add a column or include in result jsonb).

> **Decision needed:** do we want a `reviews.answer_given` text column for conjugation, so the owner can later look up what they typed? Worth it for debugging the conjugation difficulty curve. Adds one nullable text column to `reviews`. I lean yes.

**Seed strategy** — AI-generated. Verb conjugation rules are tabular; Claude is reliable here.

**Edge cases**
- iOS IME variability: NFKC normalization plus katakana→hiragana handles most punctuation/half-width drift. Romaji input is rejected (we test for kana/kanji presence).
- Empty submit: treated as "missed" auto-grade, can override.
- The user types a kanji-form when expected was kana-only (or vice versa): the alternates list and self-override cover this.

### Particle usage

> *Pick the right particle for a blanked sentence.*

**Prompt/answer shape**:

```ts
prompt: { sentence_ruby_blanked: string; options: string[]; answer_index: number }
answer: { explanation: string }
```

`sentence_ruby_blanked` contains a blank marker — convention: `___` (three underscores) — at the particle position. The card renders with the blank visually styled.

**Card UX** — `<MultipleChoiceCard>`, new component. Prompt face: the blanked sentence, four option buttons in a 2×2 grid. Tap → auto-grade → green/red highlight on the chosen option, reveal correct answer if wrong, show the explanation below. Single CTA: **Next**.

No self-grade — MC auto-grades reliably.

**Generation prompt** — `buildParticlePrompt({ count, weakness_hint? })`: N items, each a Japanese sentence with one particle slot, three plausible distractor particles, and a 1-sentence explanation. The output must include `answer_index` (0-3) pointing to the correct option in `options`.

**Grading** — auto. Result mapped to `got_it` / `missed` per Leitner.

**Seed strategy** — AI-generated.

**Edge cases**
- Claude may produce four options where multiple are valid given context. The parser doesn't detect this. The owner's "Browse → flag" affordance is Phase 3.
- Distractor placement: the prompt asks Claude to position the correct answer at a random index across the batch; we trust this.

## Dashboard screen

Replaces the current Today screen as the route after passcode. Bottom tab "Today" gets renamed to **Home** (or stays "Today" — minor; I'll match the existing label). The Home tab routes to `<DashboardScreen>`.

### Layout (mobile, top to bottom)

```
[ topbar: "Nihongo"            Settings → ]

  3-day streak · last practice 12h ago         ← single line of muted text

  ┌───────────────────────────────────┐
  │  All due across skills            │
  │  17 cards ready                   │       ← mixed-practice card (prominent)
  │             [ Start mixed → ]     │
  └───────────────────────────────────┘

  Skills

  ┌──────────┐  ┌──────────┐
  │ Vocab    │  │ Grammar  │
  │ 12 due   │  │  3 due   │
  │ tap →    │  │ tap →    │
  └──────────┘  └──────────┘
  ┌──────────┐  ┌──────────┐
  │ Particle │  │ Conjug.  │
  │  2 due   │  │ 0 due    │       ← empty skill shows "Generate" instead of count
  │ tap →    │  │ Generate │
  └──────────┘  └──────────┘
  ┌──────────┐
  │ Reading  │
  │ 0 due    │       ← grid wraps; odd row fills left column
  │ Generate │
  └──────────┘
```

### Interaction

- **Tap a skill card with due > 0** → enter Practice filtered to that skill.
- **Tap a skill card with due = 0** → expand inline into a per-skill compact GenerateForm (`mode='compact'`), so the owner can top up that skill without leaving the dashboard. After success, the card flips back to showing the new due count.
- **Tap "Start mixed"** → enter Practice with `skill_filter` unset (all due across skills).
- **Settings link** → unchanged from Phase 1.5.

### Empty-state details

- When **every skill is at 0 due**, the mixed-practice card shows "All caught up — pick a skill to generate more". The streak line continues to show.
- When a skill has both due items and new items (per Phase 1 queue logic), the count is `due + new`.

### Data feed

One new endpoint or extend `/api/stats`:

```
GET /api/dashboard
→ {
    streak_days: number,
    last_practiced_at: string | null,    // ISO; null if no reviews yet
    by_skill: {
      vocab:       { due: number, new: number },
      grammar:     { due: number, new: number },
      reading:     { due: number, new: number },
      conjugation: { due: number, new: number },
      particle:    { due: number, new: number }
    }
  }
```

One round-trip per dashboard render. Existing `/api/queue` is fine for the per-skill session entry; this endpoint exists so the dashboard doesn't have to fan out five `?skill=X` requests.

## Practice screen changes

`PracticeScreen` already accepts an item list from `/api/queue` and renders one card at a time. The change: pick the right card component per item:

```ts
function renderCard(item: ItemRecord, ...handlers) {
  switch (item.skill) {
    case 'vocab':       return <FlipCard variant="vocab"    item={item} ... />;
    case 'grammar':     return <FlipCard variant="grammar"  item={item} ... />;
    case 'reading':     return <FlipCard variant="reading"  item={item} ... />;
    case 'particle':    return <MultipleChoiceCard item={item} ... />;
    case 'conjugation': return <TypedInputCard      item={item} ... />;
  }
}
```

The Practice screen also needs to know which skill it's filtering when the user clicked from the dashboard. New URL param or pass-through prop from the Dashboard.

## Generation: server changes

**`@nihongo/gen` adds four prompt builders + four parsers.** Each parser strict-validates the per-skill output shape (e.g., particle output requires `options` to be a 4-element string array and `answer_index` in 0..3).

**`runGeneration({skill, count, weakness_hint?})`** replaces `runVocabGeneration`. It dispatches on skill: builds the right prompt, calls the right gen function, transforms the result into `items` table inserts. The transformation step is per-skill (vocab needs furigana enrichment, conjugation may not — depends on whether Claude outputs ruby HTML directly or just kana, see decision below).

> **Decision needed:** do we have Claude emit `<ruby>` HTML inline, or do we run all Japanese text through kuromoji server-side regardless? Phase 1 / 1.5 runs everything through kuromoji because the seed XML had no ruby. Asking Claude for ruby would shorten the prompt and skip kuromoji, but Claude makes more reading mistakes than kuromoji. I lean toward keeping kuromoji.

**`POST /api/generate`** request body changes:

```diff
- { skill: 'vocab', count: 1..50, weakness_hint?: string ≤200 }
+ { skill: 'vocab' | 'grammar' | 'reading' | 'conjugation' | 'particle',
+   count: 1..50,
+   weakness_hint?: string ≤200 }
```

Response shape is unchanged. The `generations.skill` column already supports the value (column default is 'vocab' but it accepts anything).

## Phasing proposal

This is a lot of work. Phase 1.5 was 22 tasks for one skill; doing five skills + a dashboard in one mega-PR would be 100+ tasks. I recommend slicing it as follows; each slice ends in a deployable, owner-testable state.

| Phase | Scope | Why this slice |
|---|---|---|
| **2.0 — Dashboard + skill generalization** | Replace Today with Dashboard. Generalize `/api/generate` to all 5 skills (but only vocab gen is "real" — others go through the same code path but the new prompt builders / parsers / card components don't exist yet, so the dashboard's "Generate" buttons on non-vocab cards are disabled with a "coming soon" caption). | Foundation. Without this, no other skill has a UI surface to land on. |
| **2.1 — Grammar** | New grammar prompt/parser/generator in @nihongo/gen. Grammar variant of `<FlipCard>`. Enable the Grammar skill card on the dashboard. | Reuses FlipCard, lowest-risk first new skill. |
| **2.2 — Particle** | New `<MultipleChoiceCard>`. Particle prompt/parser/generator. Auto-grade flow. | New card component but mechanically simple. |
| **2.3 — Conjugation** | New `<TypedInputCard>`. Conjugation prompt/parser/generator. IME normalization. Optional: add `reviews.answer_given`. | Most novel UX; isolating it keeps the iOS keyboard testing surface small. |
| **2.4 — Reading** | Reading variant of `<FlipCard>` (taller passage area, scrollable). Reading prompt/parser/generator. | Last because it's the most generation-cost expensive (longer passages). |

**Alternative:** bundle 2.0 + 2.1 (dashboard + grammar) so the first PR delivers a useful "more than vocab" state. The remaining three skills then ship one PR each. I lean toward this — see the open question below.

Each phase produces:
- A `docs/superpowers/specs/<date>-phase-2-<slice>-design.md` (focused spec) — optional; the umbrella spec here covers the design, the per-phase spec is for any deltas
- A `docs/superpowers/plans/<date>-phase-2-<slice>.md` (implementation plan)
- A PR per phase
- A green CI run + a manual smoke pass on the VM

## Cross-cutting concerns

### Stats per skill

`/api/stats/streak` stays as is (streak is cross-skill). Add `/api/stats/by-skill`:

```
GET /api/stats/by-skill?days=30
→ {
    by_skill: {
      vocab:       { box_counts: [b1, b2, b3, b4, b5], accuracy_30d: 0.78 },
      grammar:     { box_counts: [...],               accuracy_30d: 0.62 },
      ...
    }
  }
```

The Stats screen renders one block per skill. Vocab-only stats remain available via the dashboard panels; this endpoint is for the Stats screen.

This can ship in 2.0 (alongside the dashboard) since the data is already there from review history.

### Generation cost budget

Each generation is small (≤$0.05). Across five skills × periodic top-ups, monthly cost stays well under $5 unless the owner generates aggressively. No quota in v1; pricing.ts continues to be the single source of truth.

### Browse screen

Existing Browse screen filters by skill (or shows all). Each new skill's items will appear there automatically. The Browse "card preview" (currently formatted for vocab `target`/`meaning`) needs per-skill rendering — minor cosmetic update, not phased separately; rolls into whichever phase introduces the skill.

### Accessibility / humane design

Per the product-manager skill checklist:

- **Visual** — Each card component uses `var(--color-fg)` against `var(--color-bg-raised)` like the existing FlipCard. Furigana sized at `--ruby-scale` (already defined). MultipleChoiceCard's correct/incorrect feedback uses `var(--color-success)` and `var(--color-error)` plus an icon (✓ / ✗) so color-blind users aren't dependent on color alone.
- **Operation** — Buttons stay in the lower half of the viewport per the parent spec. MultipleChoice options are 56px tall (above the iOS minimum tap target). TypedInput auto-focuses the field on mount and pulls the iOS keyboard up.
- **Cognitive** — Each card has one primary action visible at a time. The Dashboard groups skills in a predictable order (alphabetical or skill-difficulty order — decision below).
- **Emotional** — Wrong answer feedback says "Not quite" (not "Wrong") and shows the correct answer + explanation. The streak line celebrates milestones at 3/7/30 days.
- **Privacy** — All data stays on the VM. Generated content is logged in `generations` for SQL forensics but never shared.

## Testing

- **gen/ unit tests** — one test file per new prompt builder + one per parser. Snapshot tests for the user prompt (with and without weakness_hint). Parse tests cover happy path, malformed JSON, missing fields, type errors.
- **server integration** — `runGeneration` test per skill (happy path, partial, failed). `POST /api/generate` test per skill (zod accepts, items inserted with `source='ai'`, generations row written). `GET /api/dashboard` test. `GET /api/stats/by-skill` test.
- **client** — no unit tests (per existing convention). Component changes verified through e2e.
- **e2e** — one Playwright scenario per skill: dashboard → tap skill → enter Practice → answer one card → assert queue advances. The existing `NIHONGO_FAKE_AI=1` fixture extends to per-skill fixtures (one canned item per skill).

## Open questions for owner

The following are calls the spec defers to you. Default answers shown; the spec works under those defaults.

1. **Phasing**: Bundle 2.0 (dashboard) + 2.1 (grammar) so the first PR delivers a useful new state? Or strict one-skill-per-PR? *(Default: bundle 2.0 + 2.1.)*
2. **Conjugation `reviews.answer_given`**: Add a nullable text column to `reviews` so the owner can later inspect what they typed? *(Default: yes, in 2.3.)*
3. **Furigana source for AI-generated items**: Continue using server-side kuromoji, or ask Claude to emit `<ruby>` HTML directly? *(Default: keep kuromoji.)*
4. **Skill ordering on dashboard**: Alphabetical (Conjugation, Grammar, Particle, Reading, Vocab) or skill-difficulty (Vocab, Grammar, Particle, Conjugation, Reading)? *(Default: difficulty.)*
5. **Tab label**: Rename bottom-tab "Today" to "Home"? *(Default: keep "Today" — minor.)*
6. **Dashboard endpoint**: Add a new `/api/dashboard` aggregator, or have the dashboard fan out 5 calls to `/api/queue?skill=X`? *(Default: new endpoint, one round-trip.)*
7. **Per-skill empty-state generation count**: When a skill has 0 due and the owner taps "Generate", what's the default count? *(Default: 10 for vocab/grammar/particle, 5 for conjugation, 3 for reading — reading is the most expensive.)*

## Future work (Phase 3 and beyond, not in 2.x)

- **Manual review gate** for AI-generated items before they enter the queue (called out in Phase 1.5 spec).
- **Item editing / flagging** in Browse.
- **Cross-skill weakness inference** (e.g., "you keep missing は/が — generate more particle drills").
- **Audio prompts** for listening comprehension.
- **JLPT-level filtering** via tags.
- **Settings UX for AI key rotation** (currently env-only).

## Sign-off checklist (before plans are written)

- [ ] Owner confirms phasing (Q1).
- [ ] Owner answers Q2–Q7 (or accepts defaults).
- [ ] Spec committed to `docs/superpowers/specs/`.
- [ ] Phase 2.0 plan drafted next, in its own document, following the Phase 1.5 plan style.
