-- 1746460800000_phase1_tables.sql
-- Adds the four tables that drive the vocab review loop. pgcrypto was enabled
-- in the Phase 0 initial migration and provides gen_random_uuid().

CREATE TABLE items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill       text NOT NULL CHECK (skill IN ('vocab','grammar','reading','conjugation','particle')),
  prompt      jsonb NOT NULL,
  answer      jsonb NOT NULL,
  source      text NOT NULL CHECK (source IN ('seed','ai','user')),
  external_id text,
  tags        text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE INDEX items_skill_idx ON items (skill);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  skill_filter text
);

CREATE TABLE review_state (
  item_id          uuid PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  box              smallint NOT NULL DEFAULT 1 CHECK (box BETWEEN 1 AND 5),
  next_review_at   timestamptz NOT NULL DEFAULT now(),
  last_reviewed_at timestamptz,
  total_reviews    int NOT NULL DEFAULT 0,
  total_missed     int NOT NULL DEFAULT 0
);

CREATE INDEX review_state_next_review_idx ON review_state (next_review_at);

CREATE TABLE reviews (
  id          bigserial PRIMARY KEY,
  item_id     uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  reviewed_at timestamptz NOT NULL,
  result      text NOT NULL CHECK (result IN ('got_it','missed')),
  box_before  smallint NOT NULL,
  box_after   smallint NOT NULL,
  session_id  uuid REFERENCES sessions(id) ON DELETE SET NULL,
  UNIQUE (item_id, reviewed_at)
);

CREATE INDEX reviews_reviewed_at_idx ON reviews (reviewed_at);
