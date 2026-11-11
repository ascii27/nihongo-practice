# User journeys

The primary workflows the app exists for, as the owner uses it: on an **iPhone 17,
opened from the Home Screen** (full-screen, drawn under the status bar). Each journey is
backed by a Playwright spec in `e2e/tests/journeys/journeys.spec.ts`, run in the
`iphone-17` project (402×874, WebKit) with the Home-Screen safe-area insets emulated
(62px top, 34px bottom). At every step the spec asserts the screen **fits**: the page
itself doesn't scroll, and the controls named below are wholly visible between the
status bar and the tab bar (or home indicator).

| Mark | Meaning |
|---|---|
| **RO** | read-only — also runs against production (`npm run e2e:prod`) |
| **Local** | writes (sessions, grades, tags, cards) — local throwaway database only |

## J1 · Daily review — Local
1. Open the app → **Today**. Fits: *Start mixed practice* is on screen.
2. *Start mixed practice*. For each card — front fits with *Close practice* and
   *Tap to reveal*; reveal; back fits with *Missed* / *Got it*; grade.
3. A long reading passage scrolls **inside** the card; the reveal and grade buttons stay
   pinned on screen.

## J2 · Class review — Local
1. Today → **Tag** picker → *Coto Academy*. Fits: *Start focused practice*.
2. Start; review a class card (as J1 step 2).

## J3 · Before class: drill — Local
1. Focus **Vocab × Coto Academy**, review its one card, back to Today.
2. Nothing is due in the focus → *Drill all N anyway* is offered, on screen.
3. Drill; the card fits. (A drill never moves the card's schedule.)

## J4 · Add class material — Local
1. **Library** → *Coto Academy* chip. Fits: *Review this tag*, *Add cards*, *Manage tag*.
2. *Add cards* → *Quick-add new*. The sheet fits: *Close add cards*, *Generate*.
3. Type a word → *Generate* → the editable preview; *Add to tag* reachable → add → close.
   The tag now counts one more card.

## J5 · Browse and tag — Local
1. Library → search *fire* → open 火. The card sheet fits with *Close card* on screen.
2. Scroll the sheet to **Tags** → *Add tag* → *Coto Academy*; the tag appears on the card.

## Read-only views — RO
- **Today** fits with and without a focus (picking a focus only reads).
- **Library** fits unfiltered (pager on screen) and with a tag selected (tag actions and
  the first card on screen).
- A **card sheet** fits.

## Running

```bash
# Local (writes, throwaway DB, fake AI) — app from `npm run dev:e2e`
DATABASE_URL=postgres://… E2E_BASE_URL=http://localhost:5173 E2E_PASSCODE=test npm run e2e:journeys

# Production, read-only, through the SSH tunnel (localhost:3101 → VM :3001)
E2E_BASE_URL=http://localhost:3101 E2E_PASSCODE=<prod passcode> npm run e2e:prod
```

`e2e:prod` sets `E2E_READ_ONLY=1`: any non-GET `/api` request (other than the passcode
check at login) is blocked and fails the test, fixtures refuse to load, and global setup
seeds nothing. `read-only-guard.spec.ts` proves the guard trips on a write.
