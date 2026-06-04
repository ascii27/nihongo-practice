-- 1780358400000_items_skill_explain.sql
-- Phase: add the `explain` skill. Widen the items.skill CHECK so the sixth
-- skill can be stored. The original constraint was an unnamed inline CHECK,
-- which Postgres named items_skill_check.
ALTER TABLE items DROP CONSTRAINT items_skill_check;
ALTER TABLE items ADD CONSTRAINT items_skill_check
  CHECK (skill IN ('vocab','grammar','reading','conjugation','particle','explain'));
