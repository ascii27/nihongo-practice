# Nihongo Practice — Design System

**Concept: "Ink & Stone"**

A warm, editorial system drawing from Japanese calligraphy and the *hanko* (判子) seal tradition. Vermillion red as the sole accent color — the color of correction ink and official stamps — against deep charcoal backgrounds. Typography in Noto Serif JP gives kanji elegant rendering while DM Mono handles all numeric displays. The result is a daily practice tool that feels like a premium physical artifact rather than a generic study app.

---

## File Structure

```
client/src/styles/
  tokens.css   — All CSS custom properties (colors, spacing, type, motion)
  base.css     — Reset + global element defaults + screen layout classes
  README.md    — This file
```

**Import order in your entry point (`main.tsx` or `index.css`):**

```css
@import './styles/tokens.css';
@import './styles/base.css';
```

Or in `main.tsx`:

```ts
import './styles/tokens.css';
import './styles/base.css';
```

---

## Color Tokens

All colors are CSS custom properties defined on `:root`. Dark mode is the default; light mode overrides via `@media (prefers-color-scheme: light)`.

| Token | Dark | Light | Intent |
|---|---|---|---|
| `--color-bg` | `#141210` | `#faf7f2` | Page / app background |
| `--color-bg-raised` | `#1e1b18` | `#ffffff` | Card and surface background |
| `--color-bg-overlay` | `#252118` | `#f5f0e8` | Modals, drawers |
| `--color-border` | `#302c28` | `#e4ddd4` | Subtle dividers |
| `--color-border-strong` | `#4a443d` | `#c8bfb5` | Interactive borders, focus rings |
| `--color-fg` | `#f0ebe2` | `#1a1714` | Primary text |
| `--color-fg-secondary` | `#b8b0a4` | `#5c5449` | Labels, secondary text |
| `--color-fg-tertiary` | `#7a7168` | `#9a9089` | Hints, placeholders, tab icons |
| `--color-accent` | `#e84c3d` | `#c93b2d` | Primary accent — vermillion |
| `--color-accent-hover` | `#f05a4b` | `#e84c3d` | Hover / active state |
| `--color-accent-muted` | `rgba(232,76,61,.15)` | `rgba(201,59,45,.1)` | Tinted backgrounds |
| `--color-accent-glow` | `rgba(232,76,61,.25)` | `rgba(201,59,45,.2)` | Focus rings, glow effects |
| `--color-success` | `#5a9e6f` | `#3d7a52` | Correct / "got it" |
| `--color-error` | `#e84c3d` | `#c93b2d` | Wrong / "missed" (shares accent) |
| `--color-muted` | alias → `--color-fg-secondary` | same | Shorthand for dimmed text |

> **Caution:** `--color-error` intentionally shares the accent hue — in this app, the only "errors" are incorrect answers, which are feedback not failures. If you add system error states (network failure toasts), consider a distinct token.

---

## Spacing Tokens

4px base grid. Use these instead of arbitrary pixel values.

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 24px |
| `--space-6` | 32px |
| `--space-7` | 48px |
| `--space-8` | 64px |
| `--space-9` | 96px |
| `--space-10` | 128px |

---

## Type Scale

Major Third ratio (~1.25×). Font size tokens are in `rem`.

| Token | Value | Usage |
|---|---|---|
| `--font-size-1` | 0.694rem (≈11px) | Labels, captions, tab bar |
| `--font-size-2` | 0.833rem (≈13px) | Small text, hints, secondary |
| `--font-size-3` | 1rem (16px) | Body text |
| `--font-size-4` | 1.25rem (20px) | Subheadings, large buttons |
| `--font-size-5` | 1.563rem (25px) | Headings, practice card sentences |
| `--font-size-6` | 2.441rem (39px) | Display, section numbers |
| `--font-size-7` | 4.768rem (76px) | Hero numbers (due count, streak) |

**Font families:**

| Token | Stack | Usage |
|---|---|---|
| `--font-body` | Noto Serif JP, Hiragino Mincho ProN, Georgia, serif | Body text, practice content |
| `--font-display` | same | Headings, app name |
| `--font-mono` | DM Mono, Hiragino Kaku Gothic ProN, ui-monospace | Numbers, codes, stats |
| `--font-ui` | Noto Serif JP, system-ui | Buttons, navigation |

---

## Ruby / Furigana Scale

```css
--ruby-scale: 0.55;
```

Used in `base.css`:

```css
rt {
  font-size: calc(1em * var(--ruby-scale)); /* 0.55em */
  line-height: 1.2;
}

ruby {
  line-height: var(--line-height-ruby); /* 2.0 — extra room above kanji */
}
```

**Why 0.55?** At font-size-5 (25px), the furigana renders at ~13.75px — comfortably legible at arm's length on a retina display, without crowding adjacent lines.

**Caution:** If you render furigana inside a `.big-number` (76px), the `rt` will be ~42px — which may be intentional or may be too large. Scope a smaller scale override:

```css
.big-number ruby rt {
  font-size: calc(1em * 0.35);
}
```

**Use `.ruby-hi-contrast`** on elements where the default secondary color (`--color-fg-secondary`) doesn't contrast enough against the background. This class sets `rt` to `--color-fg`.

---

## Radii

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | 6px | Badges, small chips |
| `--radius-md` | 12px | Inputs, small cards |
| `--radius-lg` | 20px | Buttons, standard cards |
| `--radius-xl` | 28px | Large cards, primary button |
| `--radius-full` | 9999px | Pills, dots, avatars |

---

## Shadows

Warm-toned (not cold grey). Three elevations plus two semantic variants.

| Token | Usage |
|---|---|
| `--shadow-1` | Subtle lift — small cards, inputs |
| `--shadow-2` | Medium elevation — buttons, standard cards |
| `--shadow-3` | High elevation — practice card, modals |
| `--shadow-accent` | Focus ring glow (3px accent outline) |
| `--shadow-inset` | Inset depth — pressed states, inputs |

---

## Motion Tokens

| Token | Value | Usage |
|---|---|---|
| `--duration-instant` | 80ms | Button press feedback |
| `--duration-fast` | 150ms | Color transitions, hover |
| `--duration-normal` | 250ms | Standard transitions |
| `--duration-slow` | 400ms | Card entrance, screen transitions |
| `--duration-slower` | 600ms | Staggered reveals |
| `--ease-out` | `cubic-bezier(0,0,.2,1)` | Most exits |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | Most entrances |
| `--ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | Bouncy/playful moments |
| `--ease-card-flip` | `cubic-bezier(.25,.46,.45,.94)` | Card reveal |

**Caution:** Always respect `@media (prefers-reduced-motion: reduce)` — `base.css` collapses all durations to `0.01ms` for users who need it.

---

## Dark / Light Mode Strategy

Dark mode is `:root` — no class required. Light mode is a `@media (prefers-color-scheme: light)` block that overrides only the color tokens, leaving spacing, type, radii, and motion unchanged.

**Do not** add a `.dark` or `.light` class to `<html>` — this app has no theme toggle (single user, iOS defaults respected). If a manual toggle is added later, the media query approach should be replaced with a `data-theme` attribute on `:root`.

**Topbar and tab bar** have their own `@media (prefers-color-scheme: light)` overrides inside `base.css` because their `background` uses hardcoded RGBA values for blur compatibility — keep those in sync if you change `--color-bg`.

---

## Screen Layout Classes

Every route wraps its content in `.screen`. The tab bar is fixed-position, so `.screen` adds bottom padding to prevent content from hiding behind it.

```
.screen                  Full-height flex column, scrollable
.screen--centered        Centered, for auth screens / empty states
.screen--session         No tab bar offset (full-bleed practice mode)
```

---

## Component Class Reference

Classes in `base.css` that React components (Task 11+) should use:

| Class | Description |
|---|---|
| `.screen` | Root container for every screen |
| `.screen--centered` | Modifier for centered screens (passcode, empty states) |
| `.screen--session` | Modifier for session/practice screens (no tab bar offset) |
| `.topbar` | Sticky top nav bar with blur |
| `.topbar__title` | Screen heading inside topbar |
| `.topbar__action` | Right-side action button in topbar |
| `.hero` | Primary content block at top of screen |
| `.hero__title` | Heading inside hero |
| `.hero__subtitle` | Secondary text inside hero |
| `.big-number` | Oversized mono stat number |
| `.big-number--accent` | Red variant of big-number |
| `.big-number__label` | Small label below big-number |
| `.muted` | De-emphasized secondary text |
| `.error` | Inline error message with shake animation |
| `.link` | Styled inline text link |
| `.passcode-form` | Passcode screen form wrapper |
| `.passcode-form__app-name` | App name display text |
| `.passcode-form__dots` | Row of passcode indicator dots |
| `.passcode-form__dot` | Individual dot |
| `.passcode-form__dot--filled` | Filled/active dot state |
| `.passcode-form__btn` | Passcode submit button |
| `.today-screen` | Today screen layout wrapper |
| `.stat-card` | Stats grid card |
| `.stat-card--primary` | Full-width primary stat card |
| `.btn-primary` | Large accent CTA button |
| `.btn-ghost` | Secondary ghost button |
| `.tab-bar` | Bottom navigation bar |
| `.tab-bar__item` | Individual tab |
| `.tab-bar__item--active` | Active tab state |
| `.practice-card` | Session card shell |
| `.empty-state` | Empty screen state container |
| `.ruby-hi-contrast` | High-contrast furigana variant |

---

## iOS Safe Area

`base.css` applies `env(safe-area-inset-*)` padding to `body`. Components should **not** add their own safe-area padding unless they are `position: fixed` (like `.tab-bar`, `.topbar`).

Fixed elements must independently handle safe-area insets:
- `.tab-bar` adds `padding-bottom: env(safe-area-inset-bottom)` and adjusts its own height.
- `.topbar` adds `padding-top: calc(var(--space-2) + env(safe-area-inset-top))`.

---

## Cautions for Future Contributors

1. **Don't hard-code colors.** Always use a `--color-*` token. Adding a one-off hex is how design systems break down.
2. **The grain overlay** (`body::before`) is `pointer-events: none` and `z-index: var(--z-overlay)`. Do not create elements with `z-index` between `--z-overlay` and `--z-modal` unless intentional.
3. **Furigana line-height is fragile.** Changing `--line-height-ruby` affects all body text that contains `<ruby>` tags — test on actual Japanese content before tweaking.
4. **Touch targets.** Minimum 44×44px per Apple HIG. All interactive elements in `base.css` enforce `min-height: 44px`. Don't override this without compensating with padding.
5. **The font stack assumes Noto Serif JP is loaded.** It's imported at the top of `tokens.css` via Google Fonts. If offline support is added (service worker), pre-cache these font files or the UI will fall back to Georgia/Hiragino.
6. **`@import` in `tokens.css`** pulls Noto Serif JP + DM Mono. In production, move the `<link rel="preconnect">` and font `<link>` tags to `index.html` for fastest render — Vite won't automatically do this from a CSS `@import`.
