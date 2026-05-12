-- 1778457600000_generations_table.sql
-- Phase 1.5: audit row per AI top-up generation. The `prompt` and `response`
-- jsonb columns capture the full request/response text so post-mortem on a
-- bad batch is possible in SQL without re-running the call.

CREATE TABLE generations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  skill           text NOT NULL DEFAULT 'vocab',
  count_requested integer NOT NULL,
  count_inserted  integer NOT NULL DEFAULT 0,
  weakness_hint   text,
  model           text NOT NULL,
  prompt          jsonb NOT NULL,
  response        jsonb,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  cost_usd        numeric(10,6) NOT NULL DEFAULT 0,
  status          text NOT NULL CHECK (status IN ('success','partial','failed')),
  error           text
);

CREATE INDEX generations_requested_at_idx ON generations(requested_at DESC);
