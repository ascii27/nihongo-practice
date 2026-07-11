-- 1783468800000_lessons_grammar.sql
-- Reshape `lessons` for the grammar-point-centered model. A lesson now has a
-- create `mode` ('auto' = AI picks from a theme, 'manual' = owner picked points)
-- and the resolved `grammar_point_ids` it is built around. The old per-skill
-- structure (`skills`) is no longer used to shape a lesson, so it becomes
-- optional. Existing lesson data was purged, so no backfill is needed.

ALTER TABLE lessons
  ADD COLUMN mode text NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'manual')),
  ADD COLUMN grammar_point_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE lessons ALTER COLUMN skills DROP NOT NULL;

-- Walkthrough progress: current_section (text) now holds the current block id
-- (e.g. 'grammar:<uuid>', 'vocab', 'reading'); current_index tracks position
-- within a practice block. No schema change needed — just a semantic shift.
