// Upsert the `nihongo_event` type definition on the Hermes (hermes-jester)
// instance. This is the SINGLE SOURCE OF TRUTH for the event's schema +
// documentation — edit TYPE_DEF below and re-run to change the format.
//
// Usage (needs an ADMIN-scoped key — the runtime write key cannot manage types):
//   HERMES_BASE_URL=https://lectern-queenside.exe.xyz \
//   HERMES_ADMIN_KEY=jstr_... \
//   node scripts/hermes-type.mjs
//
// On the prod VM the two vars live in the app .env:
//   ssh spruce-cedar.exe.xyz 'set -a; . /home/exedev/nihongo-practice/.env; set +a; \
//     cd /home/exedev/nihongo-practice && node scripts/hermes-type.mjs'
//
// Idempotent: creates the type if missing (POST), otherwise updates it (PUT).
// See docs/hermes-type.md.

const BASE = (process.env.HERMES_BASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.HERMES_ADMIN_KEY || "";

if (!BASE || !KEY) {
  console.error("Missing HERMES_BASE_URL or HERMES_ADMIN_KEY (admin scope required).");
  process.exit(1);
}

// ── Canonical definition ─────────────────────────────────────────────────────
const NAME = "nihongo_event";

const SCHEMA = {
  type: "object",
  required: ["event_type", "occurred_at", "data"],
  properties: {
    event_type: { type: "string", enum: ["review_logged", "milestone"] },
    occurred_at: { type: "string", format: "date-time" },
    data: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "UUID of the card." },
        skill: { type: "string", enum: ["vocab", "grammar", "particle", "conjugation", "reading", "listening", "explain"], description: "Card skill/category." },
        result: { type: "string", enum: ["got_it", "missed"], description: "review_logged: the grade." },
        reviewed_at: { type: "string", format: "date-time", description: "review_logged: when graded (idempotency key with item_id)." },
        box_before: { type: ["integer", "null"], description: "Leitner box before the grade (0 = brand-new card)." },
        box_after: { type: ["integer", "null"], description: "Box after: got_it = +1 (max 5); missed = reset to 1." },
        total_reviews: { type: ["integer", "null"], description: "Lifetime reviews of the card." },
        total_missed: { type: ["integer", "null"], description: "Lifetime misses of the card." },
        suspended: { type: ["boolean", "null"], description: "Card auto-suspended (>=8 lifetime misses)." },
        session_id: { type: ["string", "null"], description: "Study session UUID, if any." },
        front: { type: "string", description: "Card's primary label (word/pattern/verb)." },
        meaning: { type: "string", description: "Short English gloss of the card." },
        milestone_type: { type: "string", enum: ["streak"], description: "milestone: kind of milestone." },
        streak_days: { type: "integer", enum: [7, 14, 30], description: "milestone: consecutive-day streak reached." },
        session_date: { type: "string", format: "date", description: "milestone: local date (YYYY-MM-DD) the streak was hit." },
      },
    },
  },
};

const DESCRIPTION = "Japanese-study progress events from nihongo-practice (per-review grades + streak milestones), for Eva.";

const DOCUMENTATION = `# nihongo_event

Japanese-study progress from **nihongo-practice** so Eva can track learning. One
type carries two sub-events, distinguished by \`event_type\`; the relevant fields
live in \`data\`. Delivery is fire-and-forget / at-least-once — dedup on the
natural keys below.

## review_logged
Emitted once per **fresh** card grade (idempotent re-grades emit nothing).
Natural key: \`item_id\` + \`reviewed_at\`.

- \`item_id\` — the card (UUID).
- \`skill\` — vocab | grammar | particle | conjugation | reading | listening | explain.
- \`result\` — "got_it" or "missed".
- \`reviewed_at\` — ISO timestamp of the grade.
- \`front\` / \`meaning\` — the card's label + English gloss, so you can name it.
- \`box_before\` / \`box_after\` — the Leitner box (spaced-repetition level) before
  and after this grade. Box → next-review interval: 1→1d, 2→3d, 3→7d, 4→14d,
  5→30d (max). New card: box_before = 0. got_it → box +1 (capped at 5).
  missed → box resets to 1. So \`4 → 1\` = a lapse on a mature card, \`3 → 4\` = a
  promotion, \`0 → 1\` = first exposure.
- \`total_reviews\` / \`total_missed\` — lifetime counts for the card.
- \`suspended\` — true once the card has ≥8 lifetime misses (dropped from rotation).
- \`session_id\` — the study session, if the review was part of one.

## milestone
Emitted on the **first review of the day** when a study-streak threshold is
reached. Natural key: \`streak_days\` + \`session_date\`.

- \`milestone_type\` — "streak".
- \`streak_days\` — 7, 14, or 30 consecutive days with ≥1 review.
- \`session_date\` — local date (YYYY-MM-DD) the streak was hit.
- \`item_id\` — the card whose review triggered the milestone.
`;

// ── Upsert ───────────────────────────────────────────────────────────────────
const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function main() {
  const existing = await fetch(`${BASE}/api/types/${NAME}`, { headers });
  if (existing.status === 401 || existing.status === 403) {
    console.error(`Auth failed (${existing.status}). HERMES_ADMIN_KEY needs 'admin' scope.`);
    process.exit(1);
  }

  let res;
  if (existing.status === 404) {
    console.log(`Type '${NAME}' not found — creating.`);
    res = await fetch(`${BASE}/api/types`, {
      method: "POST", headers,
      body: JSON.stringify({ name: NAME, description: DESCRIPTION, documentation: DOCUMENTATION, schema: SCHEMA }),
    });
  } else {
    console.log(`Type '${NAME}' exists — updating.`);
    res = await fetch(`${BASE}/api/types/${NAME}`, {
      method: "PUT", headers,
      body: JSON.stringify({ description: DESCRIPTION, documentation: DOCUMENTATION, schema: SCHEMA }),
    });
  }

  const text = await res.text();
  if (!res.ok) {
    console.error(`Failed: HTTP ${res.status}\n${text}`);
    process.exit(1);
  }
  console.log(`OK (HTTP ${res.status}). '${NAME}' is up to date.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
