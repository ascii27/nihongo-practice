-- 1783036800000_items_skill_listening.sql
-- Phase: add the `listening` skill. Widen the items.skill CHECK so the seventh
-- skill can be stored. Constraint name is items_skill_check (see prior migration).
ALTER TABLE items DROP CONSTRAINT items_skill_check;
ALTER TABLE items ADD CONSTRAINT items_skill_check
  CHECK (skill IN ('vocab','grammar','reading','conjugation','particle','explain','listening'));
