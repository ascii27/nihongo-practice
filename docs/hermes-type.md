# Managing the `nihongo_event` Hermes type

The `nihongo_event` type on the Hermes (hermes-jester) instance defines the
**schema** every progress event is validated against, plus the **documentation**
Eva reads (via `/api/discover`) to interpret events. This is how to create or
update it.

## Source of truth

`scripts/hermes-type.mjs` holds the canonical definition (name, description,
documentation, schema). **To change the message format or description, edit that
file, then run the script** — it upserts (creates if missing, else updates).

Keep the script's `SCHEMA` in sync with what the app actually sends
(`server/src/services/hermes.ts` — `ReviewLoggedData` / `MilestoneData`). The
`data` object is permissive (no `additionalProperties: false`), so adding a field
to the sender won't 422 before you update the schema — but update it anyway so
the docs stay accurate.

## Keys — scope matters

Type management needs an **`admin`-scoped** key. The runtime `HERMES_WRITE_KEY`
has `write` scope and **cannot** read or manage types (returns 401/403). Mint an
admin key in the Hermes UI under **Keys**.

- `HERMES_BASE_URL` — the instance base URL (already in the app `.env`).
- `HERMES_ADMIN_KEY` — an admin-scoped key, used **only** by this script, never
  at runtime. Keep it out of git.

## Run it

On the prod VM (where the env lives):

```bash
ssh spruce-cedar.exe.xyz \
  'set -a; . /home/exedev/nihongo-practice/.env; set +a; \
   cd /home/exedev/nihongo-practice && node scripts/hermes-type.mjs'
```

Or locally with the vars exported:

```bash
HERMES_BASE_URL=https://lectern-queenside.exe.xyz \
HERMES_ADMIN_KEY=jstr_... \
node scripts/hermes-type.mjs
```

`npm run hermes:type` runs the same script (reads the two env vars).

## Verify

```bash
# Full manifest (schema + documentation + example), needs a read or admin key:
curl -s "$HERMES_BASE_URL/api/discover" -H "Authorization: Bearer $HERMES_ADMIN_KEY" | jq '.types[] | select(.name=="nihongo_event")'

# Just the type definition:
curl -s "$HERMES_BASE_URL/api/types/nihongo_event" -H "Authorization: Bearer $HERMES_ADMIN_KEY" | jq
```

## Notes

- `name` is immutable; to rename you must create a new type and migrate senders.
- `PUT` replaces only the fields sent; the script always sends description +
  documentation + schema together.
- Reference: hermes-jester `docs/managing-item-types.md`.
