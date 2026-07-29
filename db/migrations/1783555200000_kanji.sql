-- 1783555200000_kanji.sql
-- Kanji practice. Adds the `kanji` skill to items (widen items_skill_check) and
-- a `kanji` reference table holding the heavy shared stroke-path data (KanjiVG)
-- plus meanings/readings (KANJIDIC2). Kanji *items* stay thin — one per
-- character — and the drawing card fetches strokes from this table on demand.

ALTER TABLE items DROP CONSTRAINT items_skill_check;
ALTER TABLE items ADD CONSTRAINT items_skill_check
  CHECK (skill IN ('vocab','grammar','reading','conjugation','particle','explain','listening','kanji'));

CREATE TABLE kanji (
  character    text PRIMARY KEY,          -- the kanji literal, e.g. 食
  strokes      jsonb NOT NULL,            -- ordered SVG path 'd' strings in KanjiVG stroke order
  stroke_count smallint NOT NULL,
  radical      text,
  meanings     text[] NOT NULL DEFAULT '{}',
  on_yomi      text[] NOT NULL DEFAULT '{}',
  kun_yomi     text[] NOT NULL DEFAULT '{}',
  grade        smallint,                  -- KANJIDIC2 jōyō grade (1..8), null if none
  jlpt         text                       -- 'N5'..'N1' when mapped, else null
);

CREATE INDEX kanji_grade_idx ON kanji (grade);
CREATE INDEX kanji_jlpt_idx  ON kanji (jlpt);
