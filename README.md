# 日本語 practice

A personal Japanese study app that builds its own deck. You tell it where you're
weak; it writes drills with Claude, paints furigana over every kanji, and feeds
them back to you on a spaced-repetition schedule until they stick.

It is single-user by design — one passcode, one learner, one growing library of
cards — and tuned for an intermediate-to-advanced learner who wants drills that
sound like real life (including the workplace), not textbook filler.

---

## What it does

**Six skills, one queue.** Every card belongs to a skill, and each skill is its
own kind of exercise with its own prompt/answer shape:

| Skill | What you do |
|------|-------------|
| `vocab` | Read a sentence in context, recall a word's meaning + reading |
| `grammar` | Explain a grammar pattern shown in a sentence |
| `conjugation` | Produce a specific conjugated form (typed, graded against alternates) |
| `particle` | Pick the right particle for the blank (multiple choice) |
| `reading` | Answer a comprehension question on a short passage |
| `explain` | Write a free-text explanation using required connectives — graded by Claude on a rubric (connective use, structure, register, grammar) |

**Cards write themselves.** Hit a weakness, type a hint ("〜たら vs 〜ば",
"causative-passive"), and the generator asks Claude (Sonnet 4.6) for a fresh
batch in that skill. Explain drills lean on the learner's real domain — platform,
reliability, planning — so the Japanese is worth saying out loud. Every
generation's token cost is tracked and shown in USD.

**Furigana, automatically.** Generated Japanese runs through a
[kuromoji](https://github.com/takuyaa/kuromoji.js) tokenizer that adds reading
ruby over kanji, rendered as real `<ruby>` HTML on the cards. Output is
sanitized server-side before it ever reaches the database.

**Spaced repetition that's honest.** A 5-box Leitner scheduler (1 → 3 → 7 → 14 →
30 day intervals) promotes cards you get right and drops missed cards back to box
one. A new card's first showing always counts as exposure, never a real grade.

**Add your own words.** Paste a word or phrase, and a two-step flow translates it
(meaning, reading, an example sentence both ways) and lets you *edit the preview*
before it joins your queue — so you can sanity-check the AI before committing.

**See your progress.** A dashboard shows due/new counts per skill and your study
streak; a stats screen shows box distribution, 30-day accuracy, a daily-review
sparkline, and your five hardest cards.

---

## Architecture

A TypeScript monorepo (npm workspaces, Node ≥ 24, ESM throughout):

```
shared/   Zod schemas — the contract shared by client and server (types.ts)
gen/      AI generation: prompts, parsing, furigana, pricing (Anthropic SDK)
server/   Express API + Postgres, serves the built client in production
client/   React + Vite SPA (Dashboard, Practice, Browse, Stats, Settings)
seed/     XML → cards importer for bootstrapping the library
e2e/      Playwright end-to-end tests
db/       SQL migrations (node-pg-migrate)
```

`shared/src/types.ts` is the source of truth: every request and response is a Zod
schema, so the client and server can't drift apart silently.

The whole API sits behind a single passcode header. Auth is deliberately
minimal — this runs for one person.

---

## Quick start

```bash
# 1. Postgres
npm run db:up           # docker compose up -d postgres
npm run db:migrate

# 2. Configure
cp .env.example .env    # set PASSCODE and ANTHROPIC_API_KEY

# 3. Run (server on :3001, client on :5173)
npm run dev
```

No API key handy? Run with a stubbed generator:

```bash
npm run dev:e2e         # NIHONGO_FAKE_AI=1 — no real Claude calls
```

### Build & test

```bash
npm run build           # shared → server → client
npm test                # unit tests across shared/gen/seed/server (vitest)
npm run e2e             # Playwright
```

---

## Configuration

| Var | What it's for |
|-----|---------------|
| `PASSCODE` | The single shared secret guarding `/api/*` |
| `DATABASE_URL` | Postgres connection string |
| `ANTHROPIC_API_KEY` | Card generation and explain-grading |
| `PORT` | Server port (default `3001`) |
| `VITE_API_BASE` | Where the client points its requests |
| `NIHONGO_FAKE_AI` | Set to `1` to stub all AI calls (tests / offline dev) |

---

## How a review works

1. The client pulls the day's queue (`/api/queue`) — due cards first, then new.
2. You answer. Typed and conjugation cards grade locally against accepted forms;
   explain cards POST to `/api/explain/grade` for a Claude rubric score.
3. The result (`got_it` / `missed`) is recorded with a client-supplied timestamp,
   and the Leitner box advances or resets.
4. Tomorrow, the scheduler decides what comes back.

That loop — generate, drill, schedule, repeat — is the whole app.
