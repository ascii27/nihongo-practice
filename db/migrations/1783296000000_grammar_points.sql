-- 1783296000000_grammar_points.sql
-- The JLPT grammar catalog: one row per grammar point, grouped by JLPT level.
-- Lessons are built around 1–3 of these points. Seeded separately (next
-- migration) from the owner's curated JLPT grammar list. Reference data only —
-- no FK from lessons (lessons store grammar_point_ids as a uuid[]).

CREATE TABLE grammar_points (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jlpt_level  text NOT NULL CHECK (jlpt_level IN ('N5','N4','N3','N2','N1')),
  sort_order  int  NOT NULL,
  title       text NOT NULL,        -- the grammar point in Japanese
  romaji      text,                 -- romanized reading
  meaning     text NOT NULL,        -- short English gloss
  source      text,
  slug        text NOT NULL UNIQUE, -- stable key, e.g. 'n5-1'
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX grammar_points_level_idx ON grammar_points (jlpt_level, sort_order);
