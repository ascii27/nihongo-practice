-- 1783209600000_lesson_sections.sql
-- Per-section teaching content for a lesson: an English explanation plus worked
-- examples, generated separately from (and aware of) the section's check cards.
-- One row per taught (concept) section. Task sections have no row.

CREATE TABLE lesson_sections (
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  section   text NOT NULL,
  content   jsonb NOT NULL,
  PRIMARY KEY (lesson_id, section)
);
