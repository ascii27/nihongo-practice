-- 1783123200000_lessons.sql
-- Phase 2: the lesson layer. Lessons group ordinary `items` (via lesson_items)
-- and track guided-walkthrough progress (lesson_state). Items themselves are
-- unchanged; a lesson's items are also tagged 'lesson:<id>' for attribution.

CREATE TABLE lessons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  kind         text NOT NULL DEFAULT 'lesson' CHECK (kind IN ('lesson','assessment')),
  topic        text NOT NULL,
  jlpt_level   text NOT NULL,
  skills       text[] NOT NULL,
  status       text NOT NULL DEFAULT 'generating' CHECK (status IN ('generating','ready','failed')),
  error        text,
  cost_usd     numeric NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  generated_at timestamptz
);

CREATE INDEX lessons_status_idx ON lessons (status);

CREATE TABLE lesson_items (
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  item_id   uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  section   text NOT NULL,
  position  int  NOT NULL,
  PRIMARY KEY (lesson_id, item_id)
);

CREATE INDEX lesson_items_lesson_idx ON lesson_items (lesson_id);

CREATE TABLE lesson_state (
  lesson_id       uuid PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed')),
  current_section text,
  current_index   int NOT NULL DEFAULT 0,
  started_at      timestamptz,
  completed_at    timestamptz
);
