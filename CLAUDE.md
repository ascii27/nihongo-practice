# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-user Japanese study app: it generates its own drill cards with Claude, paints
furigana over the kanji, and serves them back on a Leitner spaced-repetition schedule.
One learner, one passcode, no user table. `README.md` covers the product; this file covers
how to work in the code.

Work is tracked in the Linear project **Nihongo Practice** (team `ASC`):
<https://linear.app/ascii27/project/nihongo-practice-d737420b4246/overview>

## Commands

TypeScript monorepo on npm workspaces, Node ≥ 24, ESM everywhere. Run everything from the
repo root; the workspaces are `shared`, `gen`, `server`, `client`, `e2e`, `seed`.

```bash
npm run db:up            # docker compose up -d postgres  (local dev DB)
npm run db:migrate       # node-pg-migrate, up to latest
npm run dev              # server :3001 + client :5173
npm run dev:e2e          # same, with NIHONGO_FAKE_AI=1 (no real Claude calls)

npm run build            # shared → server → client (server/shared "build" is tsc --noEmit)
npm test                 # vitest across shared, gen, seed, server
npm run e2e              # Playwright (needs a running app + DATABASE_URL)
```

Server tests hit a **real Postgres** — they truncate and re-seed per test via
`server/src/db/reset.ts`. They need `DATABASE_URL` and `PASSCODE` in the environment:

```bash
# whole server suite
DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo PASSCODE=test \
  npm --workspace server test

# one file
DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo PASSCODE=test \
  npx vitest run src/routes/queue.test.ts        # cwd: server/

# one test by name
... npx vitest run src/routes/queue.test.ts -t "respects the daily budget"
```

`gen`, `shared`, and `seed` tests are pure and need no database.

E2E specs need the app already listening and `DATABASE_URL` set (fixtures are loaded by
shelling out to `psql`), plus `E2E_BASE_URL` and `E2E_PASSCODE`:

```bash
DATABASE_URL=postgres://nihongo:nihongo@localhost:5432/nihongo \
E2E_BASE_URL=http://localhost:3001 E2E_PASSCODE=test npm run e2e
npx playwright test tests/kanji.spec.ts          # cwd: e2e/
```

Playwright runs **single-worker on purpose** — every spec shares one Postgres and loads a
fixture in `beforeEach`, so parallel workers race on DB state. The only project is
`iphone-14`; this app is designed phone-first.

## Architecture

```
shared/   Zod schemas — the client/server contract (src/types.ts)
gen/      Anthropic SDK calls, prompts, response parsing, furigana, token pricing
server/   Express API + Postgres; serves the built client in production
client/   React + Vite SPA, no router (App.tsx is a state machine over routes)
seed/     XML → cards importers (vocab deck, kanji dataset)
e2e/      Playwright specs + SQL fixtures
db/       SQL migrations (node-pg-migrate) and reference-data seeds
```

**`shared/src/types.ts` is the source of truth.** Every request and response body is a Zod
schema exported from there, imported by both sides. Adding or changing an endpoint starts
in `shared`, not in a route handler — that is what keeps client and server from drifting.

**Server layering.** `routes/*` parse with the shared Zod schema, then delegate; all real
logic lives in `services/*`, which is where the tests aim. Routes are mounted in
`server/src/index.ts` under `/api`, behind `passcodeMiddleware` — a single `X-Passcode`
header is the entire auth model. `/healthz` and `/audio` sit outside it. In
`NODE_ENV=production` the same Express process also serves `client/dist` and falls through
to `index.html` for non-`/api` paths, so prod is one origin and one port.

**The review loop.** `services/leitner.ts` is a pure function from
`(previous state, got_it | missed, now)` to the next state: five boxes on 1/3/7/14/30-day
intervals, a miss resets to box 1, and a brand-new card's first showing is exposure (box
stays 1) rather than a real grade. `services/session-plan.ts` is the pure arithmetic for
how big a session is and how many new cards it may introduce; **both `buildQueue` and the
dashboard call it** so the number on the hero can't promise cards the session then
refuses. Free practice (tapping a skill row) is a fixed 20 cards outside the daily budget;
mixed practice from the hero is budgeted.

**Generation.** `gen/src/prompt.ts` builds per-skill prompts, `generate.ts` calls the model
(`MODEL` is pinned in `gen/src/pricing.ts`) and `parse.ts` validates the response.
`NIHONGO_FAKE_AI=1` short-circuits every call in `gen` to a deterministic stub — that is
how CI, e2e, and offline dev run. Generated Japanese goes through the kuromoji tokenizer in
`furigana.ts` to get `<ruby>` markup, and is sanitized in `shared/src/sanitize.ts` before it
reaches the database.

**Hermes.** `server/src/services/hermes.ts` fire-and-forgets study-progress events to a
hermes-jester inbox for the Eva agent. It is a hard no-op unless both `HERMES_BASE_URL` and
`HERMES_WRITE_KEY` are set, and never throws into its caller. The channel is one-way:
Hermes is a read-only inbox, so anything writing back into this app must go through this
app's own passcode API. Changing the event shape means updating `scripts/hermes-type.mjs`
too — see `docs/hermes-type.md` (that script needs an **admin**-scoped key, not the runtime
write key).

**Migrations** are raw `.sql` in `db/migrations/`, named `<epoch-ms>_<slug>.sql`, applied by
`node-pg-migrate` via `server/src/db/migrate.ts`. New migration = new file with a larger
timestamp; never edit an applied one. If you add a table that holds per-learner state, add
it to the `TRUNCATE` list in `server/src/db/reset.ts` or tests will leak state between cases.

**Client.** No router — `App.tsx` switches on a `Route` union and passes callbacks down.
Screens live in `screens/`, card renderers (one per answer shape) in `components/`. Styling
is plain CSS with design tokens; `client/src/styles/README.md` documents the "Ink & Stone"
system and its constraints (no hard-coded colors, ruby line-height is load-bearing, 44px
touch targets, safe-area insets are applied once on `body`).

Design docs and implementation plans for past phases are in `docs/superpowers/`.

## exe.dev — deploy and live testing

The app runs on the exe.dev VM **spruce-cedar.exe.xyz** (nginx → PM2 → Express on :3001,
local Postgres 16, app dir `/home/exedev/nihongo-practice`, env in `.env` on the VM). The
production passcode is not in this repo — it is in the session memory for this project and
in the VM's `.env`.

```bash
bash scripts/deploy.sh    # pushes the current branch, then on the VM:
                          # checkout + reset --hard, npm ci, build client, typecheck
                          # server, run migrations, pm2 startOrReload, wait for healthz
```

`deploy.sh` deploys **whatever branch is checked out**, and it migrates the production
database. That is intentional: feature branches are validated live on the VM.

**The workflow for a feature branch is: finish the work → `bash scripts/deploy.sh` →
stop and let the owner test it live on <https://spruce-cedar.exe.xyz> → only then open the
PR.** Do not open the PR first. The owner wants changes validated against the real deployed
app and real review data rather than a throwaway local database.

## UI validation

**Validate UI changes by driving Playwright — never by reasoning about the markup or
calling it done because the unit tests pass.** Two levels:

- **Ad-hoc checks** while iterating: the Playwright MCP browser tools
  (`mcp__plugin_playwright_playwright__browser_navigate`, `_snapshot`, `_click`, `_type`,
  `_take_screenshot`, `_console_messages`, `_resize`). Resize to a phone viewport before
  judging layout — the design targets iPhone-sized screens, and `browser_console_messages`
  catches the React errors a screenshot hides.
- **Regressions worth keeping**: add or extend a spec in `e2e/tests/`. Reuse `helpers.ts`
  (`login`, `practiceSkill`, `generateViaSettings`, the `POST_GRADE` selector) and load the
  narrowest fixture that fits from `e2e/tests/fixtures/` rather than depending on whatever
  is in the database.

Prefer role- and label-based locators as the existing specs do; a handful of stable class
hooks (`.skill-card--<skill>`, `.practice-bar__count`) exist where roles aren't enough.

## Conventions

- ESM only: relative imports inside `server/` carry the `.js` extension even though the
  sources are `.ts`.
- Cross-workspace imports go through the package name (`@nihongo/shared`, `@nihongo/gen`),
  never a relative path across workspace boundaries.
- `server/src/env.ts` parses the environment through Zod at import time — add new server
  config there so a missing variable fails loudly at boot instead of at first use.
- `SubmitReviewRequest.reviewed_at` is **client-supplied** (ISO), not `now()` on the server,
  and per-day figures (streak, daily target, stats) are computed in a caller-supplied IANA
  zone via `services/tz.ts` — so the learner's local day is the unit, not UTC.
